import type { HTMLAttributes } from "react";

import { cx } from "@/lib/cx";

/** Page measure: 16px gutters on phones, a 72rem sheet on desktop. */
export function Container({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-10", className)} {...props} />
  );
}
