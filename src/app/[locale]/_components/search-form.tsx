"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { getPathname } from "@/i18n/navigation";
import { bookingSearchHref, parseBookingSearch } from "@/lib/booking-search";

/**
 * Trip search of the home page. It shows no price: "Get a quote" only carries the filled
 * fields to the booking page, where the server computes the quote (EPIC-08).
 *
 * Without JavaScript the form still works as a plain GET to the booking page; with it, the
 * fields are validated and normalised by `parseBookingSearch` before navigating.
 */
export function SearchForm({ titleId }: { titleId: string }) {
  const t = useTranslations("Home.search");
  const locale = useLocale();
  const router = useRouter();
  const [invalid, setInvalid] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entries = Object.fromEntries(new FormData(event.currentTarget));
    const result = parseBookingSearch(entries);
    if (!result.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    router.push(bookingSearchHref(result.data, locale));
  }

  return (
    <form
      action={getPathname({ href: "/reservation", locale })}
      method="get"
      onSubmit={onSubmit}
      aria-labelledby={titleId}
      className="flex flex-col gap-6"
    >
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <Field label={t("pickup")} className="sm:col-span-2">
          <Input
            name="pickup"
            autoComplete="off"
            maxLength={200}
            placeholder={t("placePlaceholder")}
          />
        </Field>
        <Field label={t("dropoff")} className="sm:col-span-2">
          <Input
            name="dropoff"
            autoComplete="off"
            maxLength={200}
            placeholder={t("placePlaceholder")}
          />
        </Field>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:col-span-2">
          <Field label={t("date")}>
            <Input name="date" type="date" />
          </Field>
          <Field label={t("time")} hint={t("timeHint")}>
            <Input name="time" type="time" />
          </Field>
          <Field label={t("passengers")}>
            <Input
              name="passengers"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              defaultValue={1}
            />
          </Field>
          <Field label={t("luggage")}>
            <Input
              name="luggage"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              defaultValue={0}
            />
          </Field>
        </div>
      </div>

      {invalid ? (
        <p role="alert" className="text-sm text-rubric">
          {t("invalid")}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <Button type="submit" size="lg" className="w-full">
          {t("submit")}
        </Button>
        <p className="text-sm text-graphite">{t("note")}</p>
      </div>
    </form>
  );
}
