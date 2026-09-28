import type { ButtonHTMLAttributes } from "react";

import { cx } from "@/lib/cx";

export type ButtonVariant = "primary" | "secondary" | "quiet";
export type ButtonSize = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2.5 rounded-print font-sans font-semibold " +
  "transition-[background-color,color,border-color] duration-200 ease-settle " +
  "disabled:cursor-not-allowed aria-busy:cursor-progress select-none";

// "unavailable" styles apply to disabled buttons that are not busy: a loading button keeps
// its variant's colours so in-progress never reads as unavailable.
const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-ink text-paper enabled:hover:bg-ink-raised " +
    "[&:disabled:not([aria-busy])]:bg-hairline [&:disabled:not([aria-busy])]:text-graphite",
  secondary:
    "border border-ink text-ink bg-transparent enabled:hover:bg-paper-deep " +
    "[&:disabled:not([aria-busy])]:border-hairline [&:disabled:not([aria-busy])]:text-graphite",
  quiet:
    "text-ink underline decoration-rule decoration-1 underline-offset-[6px] " +
    "enabled:hover:decoration-ink [&:disabled:not([aria-busy])]:text-graphite [&:disabled:not([aria-busy])]:no-underline",
};

const sizes: Record<ButtonSize, string> = {
  md: "min-h-12 px-5 text-[0.9375rem]",
  lg: "min-h-14 px-7 text-base tracking-[0.01em]",
};

/** Class list for anything that should look like a button (e.g. a next/link). */
export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md") {
  return cx(base, variants[variant], variant === "quiet" ? "min-h-12 px-1" : sizes[size]);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a progress mark, keeps the label, and blocks repeated submits. */
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(buttonClasses(variant, size), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <ProgressMark /> : null}
      {children}
    </button>
  );
}

function ProgressMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 animate-spin motion-reduce:animate-none"
      fill="none"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.3" />
      <path d="M8 1.5A6.5 6.5 0 0 1 14.5 8" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}
