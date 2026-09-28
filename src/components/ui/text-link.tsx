import Link from "next/link";
import type { ComponentProps } from "react";

import { cx } from "@/lib/cx";

export const textLinkClasses =
  "text-ink underline decoration-rule decoration-1 underline-offset-[5px] " +
  "transition-[text-decoration-color] duration-200 ease-settle hover:decoration-ink";

export function TextLink({ className, ...props }: ComponentProps<typeof Link>) {
  return <Link className={cx(textLinkClasses, className)} {...props} />;
}
