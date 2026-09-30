import { render, toPlainText } from "@react-email/render";
import type { ReactElement } from "react";

export interface RenderedEmail {
  readonly html: string;
  /** Plain-text alternative, derived from the HTML. */
  readonly text: string;
}

/** Renders an email element (a template wrapped in `EmailLayout`) to HTML and plain text. */
export async function renderEmail(element: ReactElement): Promise<RenderedEmail> {
  const html = await render(element);
  return { html, text: toPlainText(html) };
}
