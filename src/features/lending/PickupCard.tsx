"use client";

import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import clsx from "clsx";
import { Car, ExternalLink, Footprints, MapPin, Pencil } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { formatDistance, haversineKm, type LatLng } from "@convex/lib/geo";
import { Button } from "@/components/common/Button";
import { Textarea } from "@/components/common/Field";
import { useToast } from "@/components/common/Toast";
import { useLocation } from "@/features/discovery/LocationProvider";
import { errorMessage } from "@/lib/errors";
import { fetchRoute } from "@/services/maps";
import styles from "./LoanDetail.module.scss";

const RouteMap = dynamic(() => import("@/components/map/RouteMap"), {
  ssr: false,
  loading: () => <div className={styles.mapLoading}>Loading map…</div>,
});

function minutes(s: number) {
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function PickupCard({
  loanId,
  pickup,
  role,
  instructions,
  returnArrangement,
  canEditArrangement,
}: {
  loanId: Id<"loans">;
  pickup: { lat: number; lng: number; address: string | null };
  role: "BORROWER" | "OWNER" | "ADMIN";
  instructions: string | null;
  returnArrangement: string | null;
  canEditArrangement: boolean;
}) {
  const location = useLocation();
  const [mode, setMode] = useState<"walk" | "drive">("walk");
  const [showSteps, setShowSteps] = useState(false);
  const from: LatLng | null = role === "BORROWER" ? location.point : null;
  const route = useQuery({
    queryKey: ["route", mode, from?.lat.toFixed(4), from?.lng.toFixed(4), pickup.lat, pickup.lng],
    queryFn: () => fetchRoute(from!, pickup, mode),
    enabled: !!from,
    retry: 0,
  });
  const straight = from ? haversineKm(from, pickup) : null;
  const osmLink = from
    ? `https://www.openstreetmap.org/directions?engine=${mode === "walk" ? "fossgis_osrm_foot" : "fossgis_osrm_car"}&route=${from.lat}%2C${from.lng}%3B${pickup.lat}%2C${pickup.lng}`
    : `https://www.openstreetmap.org/?mlat=${pickup.lat}&mlon=${pickup.lng}#map=17/${pickup.lat}/${pickup.lng}`;

  return (
    <section className={styles.card} aria-labelledby="pickup-heading">
      <header className={styles.cardHead}>
        <h2 id="pickup-heading">
          <MapPin aria-hidden /> {role === "BORROWER" ? "Pickup location" : "Your pickup point"}
        </h2>
        <span className={styles.private}>Private to this loan</span>
      </header>
      <div className={styles.routeMap}>
        <RouteMap pickup={pickup} from={from} path={route.data?.path ?? null} />
      </div>
      <div className={styles.cardBody}>
        {pickup.address && <p className={styles.address}>{pickup.address}</p>}
        {role === "BORROWER" && (
          <>
            <div className={styles.routeBar}>
              <div className={styles.modes} role="group" aria-label="Travel mode">
                <button type="button" className={clsx(mode === "walk" && styles.modeOn)} onClick={() => setMode("walk")}>
                  <Footprints aria-hidden /> Walk
                </button>
                <button type="button" className={clsx(mode === "drive" && styles.modeOn)} onClick={() => setMode("drive")}>
                  <Car aria-hidden /> Drive
                </button>
              </div>
              <p className={styles.routeStat}>
                {!from ? (
                  <button type="button" className={styles.textButton} onClick={location.requestGps}>
                    Share your location for directions
                  </button>
                ) : route.isLoading ? (
                  "Finding a route…"
                ) : route.data ? (
                  <>
                    <span className="num">{formatDistance(route.data.distanceM / 1000)}</span> · <span className="num">{minutes(route.data.durationS)}</span>
                  </>
                ) : (
                  <>
                    <span className="num">{straight !== null ? formatDistance(straight) : "—"}</span> away (route unavailable)
                  </>
                )}
              </p>
              <a href={osmLink} target="_blank" rel="noopener noreferrer" className={styles.textLink}>
                Open in maps <ExternalLink aria-hidden />
              </a>
            </div>
            {route.data && route.data.steps.length > 0 && (
              <div>
                <button type="button" className={styles.textButton} onClick={() => setShowSteps((s) => !s)}>
                  {showSteps ? "Hide directions" : "Show turn-by-turn directions"}
                </button>
                {showSteps && (
                  <ol className={styles.steps}>
                    {route.data.steps.map((s, i) => (
                      <li key={i}>
                        <span>{s.instruction}</span>
                        <span className="num">{s.distanceM > 0 ? formatDistance(s.distanceM / 1000) : ""}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </>
        )}
        {instructions && (
          <div className={styles.infoBlock}>
            <h3>Owner&apos;s instructions</h3>
            <p>{instructions}</p>
          </div>
        )}
        <ReturnArrangement loanId={loanId} value={returnArrangement} editable={canEditArrangement} />
      </div>
    </section>
  );
}

function ReturnArrangement({ loanId, value, editable }: { loanId: Id<"loans">; value: string | null; editable: boolean }) {
  const save = useMutation(api.loans.setReturnArrangement);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  if (!editable && !value) return null;
  return (
    <div className={styles.infoBlock}>
      <h3>
        Return arrangement
        {editable && !editing && (
          <button type="button" className={styles.iconText} onClick={() => setEditing(true)}>
            <Pencil aria-hidden /> {value ? "Edit" : "Add"}
          </button>
        )}
      </h3>
      {editing ? (
        <div className={styles.editRow}>
          <Textarea rows={2} maxLength={1000} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Same place as pickup, any evening after 6pm." aria-label="Return arrangement" />
          <div className={styles.editActions}>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await save({ loanId, note: draft });
                  setEditing(false);
                  toast.success("Return arrangement saved.");
                } catch (e) {
                  toast.error(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p>{value ?? "Return to the pickup point unless agreed otherwise."}</p>
      )}
    </div>
  );
}
