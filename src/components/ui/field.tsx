"use client";

import {
  createContext,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

import { cx } from "@/lib/cx";

type FieldContextValue = {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

function useField(): FieldContextValue {
  const context = useContext(FieldContext);
  if (!context) throw new Error("Input and Select must be rendered inside <Field>.");
  return context;
}

type FieldProps = {
  label: string;
  /** Short guidance shown under the control, e.g. an expected format. */
  hint?: string;
  /** Names the problem and how to fix it. Presence marks the control invalid. */
  error?: string;
  required?: boolean;
  /** Visible "(facultatif)" marker text, localised by the caller. */
  optionalLabel?: string;
  className?: string;
  children: ReactNode;
};

export function Field({
  label,
  hint,
  error,
  required = false,
  optionalLabel,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error), required }}>
      <div className={cx("flex flex-col gap-1.5", className)}>
        <label htmlFor={id} className="flex items-baseline gap-2 small-caps-label text-graphite">
          {label}
          {!required && optionalLabel ? (
            <span className="font-normal tracking-normal normal-case">{optionalLabel}</span>
          ) : null}
        </label>
        {children}
        {error ? (
          <p id={errorId} className="flex items-start gap-1.5 text-sm text-rubric">
            <ErrorMark />
            {error}
          </p>
        ) : null}
        {hint ? (
          <p id={hintId} className="text-sm text-graphite">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

// A ledger line rather than a box: the 1px graphite rule (3.1:1 on ivory) is the control's edge.
const controlBase =
  "w-full min-h-12 bg-transparent px-0 py-2 text-base text-ink " +
  "border-0 border-b border-rule rounded-none " +
  "transition-[border-color,box-shadow] duration-200 ease-settle " +
  "placeholder:text-graphite hover:border-ink " +
  // Focus is a 3px ink underline (hover is 1px): focus always wins over the error colour,
  // the error stays announced by its message and aria-invalid.
  "focus-visible:outline-none focus-visible:border-ink focus-visible:shadow-[0_2px_0_0_var(--color-ink)] " +
  "aria-invalid:not-focus-visible:border-rubric aria-invalid:not-focus-visible:shadow-[0_1px_0_0_var(--color-rubric)] " +
  "disabled:cursor-not-allowed disabled:text-graphite disabled:border-hairline";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const field = useField();
  return (
    <input
      id={field.id}
      aria-describedby={field.describedBy}
      aria-invalid={field.invalid || undefined}
      required={field.required}
      className={cx(controlBase, className)}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const field = useField();
  return (
    <div className="relative">
      <select
        id={field.id}
        aria-describedby={field.describedBy}
        aria-invalid={field.invalid || undefined}
        required={field.required}
        className={cx(controlBase, "cursor-pointer appearance-none pr-8", className)}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 12 8"
        className="pointer-events-none absolute top-1/2 right-1 h-2 w-3 -translate-y-1/2 text-ink"
        fill="none"
      >
        <path d="M1 1.5 6 6.5l5-5" stroke="currentColor" strokeWidth="1.25" />
      </svg>
    </div>
  );
}

function ErrorMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0" fill="none">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.25" />
      <path d="M8 4.5v4.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.25" r="0.9" fill="currentColor" />
    </svg>
  );
}
