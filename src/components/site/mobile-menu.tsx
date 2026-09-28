"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { buttonClasses } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Link } from "@/i18n/navigation";
import { cx } from "@/lib/cx";

import { SITE_NAV } from "./nav";

/**
 * Disclosure menu for small screens: a real button with `aria-expanded`, Escape closes it and
 * returns focus to the button, opening moves focus to the first link. Rendered inside the
 * site header, which is its positioning context.
 */
export function MobileMenu({ className }: { className?: string }) {
  const t = useTranslations("Site");
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("a[href]")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className={className}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="-mr-2 inline-flex min-h-12 items-center gap-3 px-2 font-semibold"
      >
        {t("menu")}
        <MenuMark open={open} />
      </button>

      <div
        ref={panelRef}
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full z-20 border-b border-hairline bg-paper"
      >
        <Container className="flex flex-col gap-6 pt-2 pb-8">
          <nav aria-label={t("navLabel")}>
            <ul className="flex flex-col">
              {SITE_NAV.map((item) => (
                <li key={item.key} className="border-b border-hairline">
                  <Link
                    href={item.href}
                    onClick={close}
                    className="flex min-h-14 items-center font-display-optical text-2xl"
                  >
                    {t(`nav.${item.key}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <LocaleSwitcher />
          <Link
            href="/reservation"
            onClick={close}
            className={cx(buttonClasses("primary", "lg"), "w-full")}
          >
            {t("book")}
          </Link>
        </Container>
      </div>
    </div>
  );
}

/** Two printed rules that cross when the menu is open. Decorative. */
function MenuMark({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="none">
      {open ? (
        <path d="m4 4 12 12M16 4 4 16" stroke="currentColor" strokeWidth="1.5" />
      ) : (
        <path d="M2 7h16M2 13h16" stroke="currentColor" strokeWidth="1.5" />
      )}
    </svg>
  );
}
