import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * The single marker for provisional content (VTC-018): every text that stands in for an open
 * decision is wrapped in it, so it can be found (`data-provisional`) and replaced once the
 * decision is taken. `decisions` names the open `DEC-*` entries; it is omitted only when the
 * content waits for a later epic rather than for a decision.
 */
export function ProvisionalNotice({
  decisions,
  children,
  className,
}: {
  decisions?: string;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations("Provisional");

  return (
    <aside
      data-provisional={decisions ?? ""}
      className={cx(
        "flex max-w-[65ch] flex-col gap-2 border border-dashed border-rule px-5 py-4",
        className,
      )}
    >
      <p className="small-caps-label text-graphite">
        {decisions ? t("labelWithDecisions", { decisions }) : t("label")}
      </p>
      <div className="flex flex-col gap-2">{children}</div>
    </aside>
  );
}
