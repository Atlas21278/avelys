"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { RouteLine, type RouteStop } from "@/components/ui/route-line";

export function RouteDemo({ stops }: { stops: readonly RouteStop[] }) {
  const [committed, setCommitted] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <RouteLine
        stops={stops}
        committed={committed}
        label="Itinéraire"
        legLabel="Trajet jusqu'à l'étape suivante"
      />
      <Button variant="secondary" onClick={() => setCommitted((value) => !value)}>
        {committed ? "Revenir au tracé possible" : "Retenir cet itinéraire"}
      </Button>
    </div>
  );
}
