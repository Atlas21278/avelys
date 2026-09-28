import type { ReactNode } from "react";

export function AuthHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-2">
      <p className="small-caps-label text-graphite">Avelys · Back-office</p>
      <h1 className="font-display-optical text-display-sm">{title}</h1>
      {children ? <p className="text-graphite">{children}</p> : null}
    </header>
  );
}
