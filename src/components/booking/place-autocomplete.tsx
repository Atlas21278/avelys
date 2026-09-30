"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { Field, Input } from "@/components/ui/field";
import type { ChosenPlace } from "@/lib/booking-quote";
import {
  CLOSED_COMBOBOX,
  comboboxKey,
  reachableOptionCount,
  type ComboboxState,
  type SuggestionStatus,
} from "@/lib/combobox";
import type { PlaceInput } from "@/lib/quote-step-state";
import { cx } from "@/lib/cx";
import {
  MapsBrowserError,
  type PlaceSuggestion,
  type PlaceSuggestionSource,
} from "@/integrations/maps/browser";

/** Characters typed before the first (billed) suggestion request. UX setting, not a rule. */
const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 250;

type PlaceAutocompleteProps = {
  label: string;
  value: PlaceInput;
  source: PlaceSuggestionSource;
  onTextChange: (text: string) => void;
  onChoose: (place: ChosenPlace) => void;
  /** The Maps script or key cannot be used at all: the page stops offering a quote. */
  onUnavailable: () => void;
  /** Field-level error from the last submit attempt. */
  error?: string;
};

/**
 * Place field with Places suggestions (VTC-046): an ARIA 1.2 combobox with a listbox popup.
 * Focus stays in the text field; arrows move the highlighted option, Enter chooses it, Escape
 * closes the list. Only a chosen suggestion is a valid place: typing again forgets it.
 */
export function PlaceAutocomplete({
  label,
  value,
  source,
  onTextChange,
  onChoose,
  onUnavailable,
  error,
}: PlaceAutocompleteProps) {
  const t = useTranslations("Pages.booking.quote");
  const listboxId = useId();
  const [suggestions, setSuggestions] = useState<readonly PlaceSuggestion[]>([]);
  const [status, setStatus] = useState<SuggestionStatus>("idle");
  const [combobox, setCombobox] = useState<ComboboxState>(CLOSED_COMBOBOX);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(0);
  // Whether the text field has focus: a late answer opens the list only for a visitor still there.
  const focused = useRef(false);

  useEffect(() => () => clearTimeout(timer.current), []);

  function query(text: string) {
    clearTimeout(timer.current);
    const request = ++latest.current;
    if (text.trim().length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setStatus("idle");
      setCombobox(CLOSED_COMBOBOX);
      return;
    }
    // The previous list no longer answers the text: drop it so it cannot be chosen meanwhile.
    setSuggestions([]);
    setStatus("loading");
    setCombobox(CLOSED_COMBOBOX);
    timer.current = setTimeout(() => {
      source.suggest(text).then(
        (found) => {
          if (request !== latest.current) return;
          setSuggestions(found);
          setStatus("ready");
          // Open the list only if the visitor is still in this field.
          setCombobox(focused.current ? { open: true, activeIndex: -1 } : CLOSED_COMBOBOX);
        },
        (failure: unknown) => {
          if (request !== latest.current) return;
          setSuggestions([]);
          setStatus("failed");
          setCombobox(CLOSED_COMBOBOX);
          if (failure instanceof MapsBrowserError && failure.reason !== "request_failed") {
            onUnavailable();
          }
        },
      );
    }, DEBOUNCE_MS);
  }

  function choose(suggestion: PlaceSuggestion) {
    latest.current += 1;
    clearTimeout(timer.current);
    source.endSession();
    setSuggestions([]);
    setStatus("idle");
    setCombobox(CLOSED_COMBOBOX);
    onChoose({ placeId: suggestion.placeId, label: suggestion.label });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const result = comboboxKey(
      combobox,
      event.key,
      reachableOptionCount(status, suggestions.length),
    );
    if (result.handled) event.preventDefault();
    setCombobox(result.state);
    if (result.choose !== undefined) {
      const suggestion = suggestions[result.choose];
      if (suggestion) choose(suggestion);
    }
  }

  const open = combobox.open && status === "ready";
  const activeId =
    open && combobox.activeIndex >= 0 ? `${listboxId}-${combobox.activeIndex}` : undefined;
  const needsConfirmation = value.text.trim() !== "" && value.chosen === null;
  const hint = value.chosen ? t("placeChosen") : needsConfirmation ? t("placeConfirm") : undefined;

  let announcement = "";
  if (status === "ready") {
    announcement =
      suggestions.length === 0
        ? t("suggestionsEmpty")
        : t("suggestionsCount", { count: suggestions.length });
  } else if (status === "failed") {
    announcement = t("suggestionsFailed");
  }

  return (
    <Field label={label} error={error} hint={hint} required>
      <div className="relative">
        <Input
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          placeholder={t("placePlaceholder")}
          value={value.text}
          onChange={(event) => {
            onTextChange(event.target.value);
            query(event.target.value);
          }}
          onFocus={() => {
            focused.current = true;
            if (value.chosen === null && suggestions.length === 0) query(value.text);
          }}
          onBlur={() => {
            focused.current = false;
            setCombobox(CLOSED_COMBOBOX);
          }}
          onKeyDown={onKeyDown}
        />
        <ul
          id={listboxId}
          role="listbox"
          aria-label={label}
          hidden={!open || suggestions.length === 0}
          className="absolute inset-x-0 top-full z-20 -mt-px max-h-80 overflow-y-auto border border-ink bg-paper"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.placeId}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={index === combobox.activeIndex}
              // Keep focus in the field: the choice happens on click, the blur must not close first.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(suggestion)}
              className={cx(
                "flex min-h-12 cursor-pointer flex-col justify-center border-b border-hairline px-3 py-2 last:border-b-0",
                index === combobox.activeIndex ? "bg-paper-deep" : "hover:bg-paper-deep",
              )}
            >
              <span>{suggestion.mainText}</span>
              {suggestion.secondaryText ? (
                <span className="text-sm text-graphite">{suggestion.secondaryText}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      {status === "ready" && suggestions.length === 0 ? (
        <p className="text-sm text-graphite">{t("suggestionsEmpty")}</p>
      ) : null}
      {status === "failed" ? (
        <p className="text-sm text-graphite">{t("suggestionsFailed")}</p>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {status === "loading" ? t("suggestionsLoading") : announcement}
      </p>
    </Field>
  );
}
