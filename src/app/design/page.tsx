import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { Button, buttonClasses } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Field, Input, Select } from "@/components/ui/field";
import { PriceSlot } from "@/components/ui/price-slot";
import { RouteLine } from "@/components/ui/route-line";
import { Signet } from "@/components/ui/signet";
import { TextLink } from "@/components/ui/text-link";
import { money } from "@/lib/money";

import { RouteDemo } from "./route-demo";

export const metadata: Metadata = {
  title: "Planche du design system — Avelys",
  robots: { index: false, follow: false },
};

// Internal reference sheet: available in development and preview, never in production.
export default function DesignSheet() {
  if (process.env.APP_ENV === "production") notFound();

  // Leg values are fictitious, for layout only (labelled on the sheet).
  const route = [
    {
      label: "Aéroport Charles-de-Gaulle",
      detail: "Terminal 2E, porte 8",
      legToNext: { distance: "32,4 km", duration: "45 min" },
    },
    { label: "Hôtel, Paris 8ᵉ", detail: "Arrivée estimée après le trajet routier" },
  ] as const;

  return (
    <main className="pb-24">
      <header className="bg-ink text-paper">
        <Container className="flex flex-col gap-3 pt-14 pb-10">
          <h1 className="font-display-optical text-display">Avelys, le guide</h1>
          <p className="max-w-[46ch] text-on-ink-muted">
            Reliure anthracite, pages ivoire, un seul signet champagne. Chaque trajet se lit comme
            un itinéraire de guide.
          </p>
        </Container>
      </header>

      <Container className="flex flex-col gap-20 pt-16">
        <Section title="Couleurs">
          <dl className="grid grid-cols-2 gap-px border border-hairline bg-hairline sm:grid-cols-4">
            {[
              ["Encre", "bg-ink", "#1F2124", "Texte, reliure, action principale"],
              ["Papier", "bg-paper", "#F4EFE6", "Fond de page"],
              ["Papier profond", "bg-paper-deep", "#EAE3D6", "Fiche, survol"],
              ["Graphite", "bg-graphite", "#5B5852", "Annotations, 6,2:1"],
              ["Filet", "bg-rule", "#8C877E", "Bord des champs, 3,1:1"],
              ["Champagne", "bg-champagne", "#B8996A", "Signet, jamais du texte sur papier"],
              ["Champagne foncé", "bg-champagne-deep", "#7A5F32", "Texte accentué, 5,2:1"],
              ["Rubrique", "bg-rubric", "#9C2B20", "Erreurs, 6,6:1"],
            ].map(([name, swatch, hex, use]) => (
              <div key={name} className="flex flex-col gap-3 bg-paper p-4">
                <span aria-hidden="true" className={`h-14 border border-hairline ${swatch}`} />
                <dt className="font-semibold">{name}</dt>
                <dd className="flex flex-col text-sm text-graphite">
                  <data value={hex}>{hex}</data>
                  <span>{use}</span>
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="Typographie">
          <div className="flex flex-col gap-6 border-t border-hairline pt-6">
            <p className="font-display-optical text-display">Paris, dès l&apos;arrivée</p>
            <p className="font-display-figure text-display-sm">Charles-de-Gaulle → Paris 8ᵉ</p>
            <p className="max-w-[65ch] text-lg">
              Les deux fondateurs d&apos;Avelys vous conduisent eux-mêmes, en berline électrique. Le
              prix est fixé avant la réservation, à partir du trajet routier réel.
            </p>
            <p className="max-w-[65ch] text-sm text-graphite">
              Les petites capitales étiquettent les champs et les données ; elles ne se placent
              jamais au-dessus d&apos;un titre.
            </p>
            <table className="w-full max-w-md text-left text-sm">
              <caption className="border-b border-ink pb-2 text-left small-caps-label text-graphite">
                Tableau d&apos;itinéraire · valeurs fictives
              </caption>
              <thead>
                <tr className="border-b border-hairline text-graphite">
                  <th scope="col" className="py-2 font-semibold">
                    Trajet
                  </th>
                  <th scope="col" className="py-2 text-right font-semibold">
                    Distance
                  </th>
                  <th scope="col" className="py-2 text-right font-semibold">
                    Durée
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-hairline">
                  <td className="py-2">Exemple A → B</td>
                  <td className="py-2 text-right">32,4 km</td>
                  <td className="py-2 text-right">45 min</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Actions">
          <div className="flex flex-wrap items-center gap-4">
            <Button size="lg">Voir le prix</Button>
            <Button variant="secondary">Nous appeler</Button>
            <Button variant="quiet">Modifier l&apos;itinéraire</Button>
            <Button loading>Calcul du prix</Button>
            <Button disabled>Indisponible</Button>
            <a href="#champs" className={buttonClasses("secondary", "md")}>
              Lien en forme de bouton
            </a>
          </div>
          <p className="mt-6">
            Lien dans le texte : consultez les{" "}
            <TextLink href="#champs">conditions de réservation</TextLink>.
          </p>
        </Section>

        <Section title="Champs" id="champs">
          <form className="grid max-w-3xl gap-8 sm:grid-cols-2" noValidate>
            <Field label="Départ" hint="Adresse, gare, aéroport ou hôtel" required>
              <Input name="pickup" autoComplete="off" placeholder="Aéroport Charles-de-Gaulle" />
            </Field>
            <Field
              label="Destination"
              required
              error="Indiquez une destination pour calculer le prix."
            >
              <Input name="dropoff" autoComplete="off" />
            </Field>
            <Field label="Passagers" required>
              <Select name="passengers" defaultValue="2">
                {[1, 2, 3, 4].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Numéro de vol" optionalLabel="(facultatif)">
              <Input name="flight" placeholder="AF 1234" />
            </Field>
            <Field label="Code promo" optionalLabel="(facultatif)">
              <Input name="promo" disabled placeholder="Bientôt disponible" />
            </Field>
          </form>
        </Section>

        <Section title="Itinéraire et prix">
          <p className="-mt-4 text-sm text-graphite">
            Distances et durées fictives, pour la mise en page.
          </p>
          <div className="grid items-start gap-10 md:grid-cols-2">
            <article className="relative flex flex-col gap-8 bg-paper-deep p-6 shadow-page">
              <Signet className="absolute -top-2 right-6" />
              <h3 className="small-caps-label text-graphite">Tracé possible, puis retenu</h3>
              <RouteDemo stops={route} />
            </article>
            <div className="flex flex-col gap-6">
              <RouteLine
                stops={route}
                committed
                label="Itinéraire retenu"
                legLabel="Trajet jusqu'à l'étape suivante"
              />
              <PriceSlot
                price={null}
                locale="fr"
                label="Prix fixe, TTC"
                emptyLabel="Calculé dès que l'itinéraire est complet"
              />
              <PriceSlot
                price={money(8_450)}
                locale="fr"
                label="Prix fixe, TTC (exemple fictif)"
                emptyLabel=""
              />
            </div>
          </div>
        </Section>
      </Container>
    </main>
  );
}

function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id ?? title}-title`} className="flex flex-col gap-8">
      <h2 id={`${id ?? title}-title`} className="font-display-optical text-display-sm">
        {title}
      </h2>
      {children}
    </section>
  );
}
