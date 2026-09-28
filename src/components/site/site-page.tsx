import type { ReactNode } from "react";

import { Container } from "@/components/ui/container";

import { SiteFooter } from "./footer";
import { SiteHeader } from "./header";

/** Frame of a public content page: shared header and footer, one `h1` and an optional lead. */
export function SitePage({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main>
        <Container className="flex flex-col gap-12 pt-10 pb-24 sm:pt-16">
          <div className="flex flex-col gap-4 border-b border-hairline pb-10">
            <h1 className="font-display-optical text-display-sm">{title}</h1>
            {lead ? <p className="max-w-[60ch] text-lg">{lead}</p> : null}
          </div>
          {children}
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}

/** A titled block inside a content page. */
export function PageSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-5">
      <h2 id={`${id}-title`} className="font-display-figure text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}
