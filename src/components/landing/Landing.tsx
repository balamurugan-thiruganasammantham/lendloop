"use client";

import { useAuth } from "@clerk/nextjs";
import clsx from "clsx";
import { useQuery } from "convex/react";
import { ArrowRight, MapPin, ShieldCheck } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import { CATEGORY_LABELS, CONDITION_LABELS, TOOL_CATEGORIES, type ToolCategory } from "@convex/lib/constants";
import { Logo } from "@/components/brand/Logo";
import { EmptyState, LoadingState } from "@/components/common/States";
import { CATEGORY_ICONS } from "@/components/common/ToolThumb";
import { LocationBanner, LocationCta } from "@/features/discovery/LocationCta";
import { LocationProvider, useLocation } from "@/features/discovery/LocationProvider";
import { distanceLabel, sortByDistance, withLiveDistances } from "@/lib/location";
import styles from "./Landing.module.scss";

const PublicMap = dynamic(() => import("./PublicMap"), {
  ssr: false,
  loading: () => <div className={styles.mapLoading} />,
});

const STEPS = [
  ["Find", "Browse tools on the map. Locations stay approximate until a loan is approved."],
  ["Request", "Pick dates and add a note. Lenders see your verified borrowing record."],
  ["Meet & verify", "At pickup the lender enters your one-time code to confirm the hand-over."],
  ["Return & review", "Hand it back, confirm with a second code, and leave honest feedback."],
] as const;

export function Landing() {
  const { isSignedIn, isLoaded } = useAuth();
  const signedIn = isLoaded && !!isSignedIn;
  // Respect a member's "location sharing" profile setting; visitors default to sharing on.
  const me = useQuery(api.users.me, signedIn ? {} : "skip");
  const sharing = !isLoaded ? null : signedIn ? (me === undefined ? null : (me?.locationSharing ?? true)) : true;
  return (
    <LocationProvider sharingEnabled={sharing}>
      <LandingView signedIn={signedIn} />
    </LocationProvider>
  );
}

function LandingView({ signedIn }: { signedIn: boolean }) {
  const location = useLocation();
  const point = location.point;
  const data = useQuery(api.tools.publicPreview, {});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [category, setCategory] = useState<ToolCategory | "ALL">("ALL");
  const [recenter, setRecenter] = useState(0);

  // With a location, "Available near you" really is nearest first, with distances from the visitor.
  const all = useMemo(() => {
    const items = (data?.items ?? []).map((i) => ({
      ...i,
      distanceKm: null as number | null,
    }));
    return point ? sortByDistance(withLiveDistances(items, point)) : items;
  }, [data, point]);
  const counts = useMemo(() => {
    const c: Partial<Record<ToolCategory, number>> = {};
    for (const i of all) c[i.category] = (c[i.category] ?? 0) + 1;
    return c;
  }, [all]);
  const items = all.filter((i) => category === "ALL" || i.category === category);
  const availableNow = all.filter((i) => i.availableNow).length;
  const selected = all.find((i) => i.id === selectedId) ?? null;

  return (
    <div className={styles.page}>
      <aside className={styles.panel}>
        <header className={styles.top}>
          <Logo />
          <nav className={styles.nav}>
            {signedIn ? (
              <Link href="/explore" className={styles.navCta}>
                Open the map <ArrowRight aria-hidden />
              </Link>
            ) : (
              <>
                <Link href="/sign-in" className={styles.navLink}>
                  Log in
                </Link>
                <Link href="/sign-up" className={styles.navCta}>
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </header>

        <section className={styles.hero}>
          <p className={styles.crumbs}>
            Bengaluru <span aria-hidden>›</span> <strong>Indiranagar</strong>
          </p>
          <h1 className={clsx(styles.title, "display")}>
            Borrow what you need. <em>Lend what you don&apos;t.</em>
          </h1>
          <p className={styles.lede}>
            The drill you use twice a year is somebody&apos;s whole weekend project. LendLoop puts the tools in your neighbourhood on one map — with verified
            hand-overs and honest reputations.
          </p>
          {data && (
            <p className={styles.stats}>
              <strong className="num">{data.stats.tools}</strong> tools · <strong className="num">{availableNow}</strong> available now ·{" "}
              <strong className="num">{data.stats.areas}</strong> neighbourhoods
            </p>
          )}
          <div className={styles.ctas}>
            <Link href={signedIn ? "/explore" : "/sign-up"} className={styles.ctaPrimary}>
              {signedIn ? "Open the map" : "Sign in to borrow"} <ArrowRight aria-hidden />
            </Link>
            <Link href={signedIn ? "/listings/new" : "/sign-up"} className={styles.ctaSecondary}>
              Lend a tool
            </Link>
          </div>
          <div className={styles.chips} role="toolbar" aria-label="Categories">
            <button
              type="button"
              aria-pressed={category === "ALL"}
              className={clsx(styles.chip, category === "ALL" && styles.chipOn)}
              onClick={() => setCategory("ALL")}
            >
              All <span className="num">{all.length}</span>
            </button>
            {TOOL_CATEGORIES.filter((c) => counts[c]).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={category === c}
                className={clsx(styles.chip, category === c && styles.chipOn)}
                onClick={() => setCategory(category === c ? "ALL" : c)}
              >
                {CATEGORY_LABELS[c]} <span className="num">{counts[c]}</span>
              </button>
            ))}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="available-heading">
          <div className={styles.sectionHead}>
            <h2 id="available-heading">Available near you</h2>
            <span className="num">{items.length}</span>
          </div>
          <div className={styles.locationRow}>
            <LocationBanner />
          </div>
          {data === undefined ? (
            <LoadingState rows={3} />
          ) : items.length === 0 ? (
            <EmptyState compact title="No tools listed yet" description="Be the first to lend something in your neighbourhood." />
          ) : (
            <ul className={styles.grid}>
              {items.slice(0, 24).map((t) => {
                const Icon = CATEGORY_ICONS[t.category];
                return (
                  <li key={t.id} className={styles.cardItem}>
                    <button
                      type="button"
                      className={clsx(styles.card, selectedId === t.id && styles.cardOn)}
                      onClick={() => setSelectedId(t.id)}
                      onMouseEnter={() => setHoveredId(t.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      <span className={styles.cardMedia}>
                        {t.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL
                          <img src={t.imageUrl} alt="" loading="lazy" />
                        ) : (
                          <Icon aria-hidden strokeWidth={1.3} />
                        )}
                        <span className={clsx(styles.cardStatus, !t.availableNow && styles.cardStatusReserved)}>
                          <span aria-hidden /> {t.availableNow ? "Available" : "Booked soon"}
                        </span>
                        {t.distanceKm !== null && (
                          <span className={clsx(styles.cardDistance, "num")} title="Distance to the approximate pickup area">
                            {distanceLabel(t.distanceKm)}
                          </span>
                        )}
                      </span>
                      <span className={clsx(styles.cardName, "display")}>{t.name}</span>
                      <span className={styles.cardMeta}>
                        {CATEGORY_LABELS[t.category]} · {CONDITION_LABELS[t.condition]}
                      </span>
                      <span className={styles.cardArea}>
                        <MapPin aria-hidden /> {t.pickupArea.split(",")[0]}
                        {t.isSeed && <em>Sample</em>}
                      </span>
                    </button>
                    {t.distanceKm === null && <LocationCta className={styles.cardLocate} />}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={styles.section} aria-labelledby="how-heading">
          <div className={styles.sectionHead}>
            <h2 id="how-heading">How it works</h2>
          </div>
          <ol className={styles.steps}>
            {STEPS.map(([title, body], i) => (
              <li key={title}>
                <span className={clsx(styles.stepNum, "display")}>{i + 1}</span>
                <div>
                  <p className={styles.stepTitle}>{title}</p>
                  <p className={styles.stepBody}>{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <footer className={styles.footer}>
          <ShieldCheck aria-hidden />
          <p>
            Exact addresses are never shown publicly. Map positions are approximate (within ~500 m); the precise pickup point is shared only with an approved
            borrower. Listings marked <em>Sample</em> are demo data.
          </p>
        </footer>
      </aside>

      <main className={styles.map} aria-label="Map of available tools">
        <PublicMap
          tools={items}
          selectedId={selectedId}
          hoveredId={hoveredId}
          onSelect={setSelectedId}
          onHover={setHoveredId}
          me={
            location.state.status === "ready"
              ? {
                  point: location.state.point,
                  manual: location.state.source === "manual",
                  label: location.state.label,
                }
              : null
          }
          onLocate={() => {
            location.requestGps();
            setRecenter((r) => r + 1);
          }}
          locating={location.state.status === "locating"}
          recenterKey={recenter}
        />
        {selected && (
          <div className={styles.float} role="dialog" aria-label={selected.name}>
            <span className={styles.floatMedia}>
              {selected.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL
                <img src={selected.imageUrl} alt="" />
              ) : null}
            </span>
            <span className={styles.floatText}>
              <span className={clsx(styles.floatName, "display")}>{selected.name}</span>
              <span className={styles.floatMeta}>
                {CATEGORY_LABELS[selected.category]} · {selected.pickupArea.split(",")[0]}
                {selected.distanceKm !== null && <span className="num"> · {distanceLabel(selected.distanceKm)} away</span>}
              </span>
              {selected.distanceKm === null && <LocationCta variant="inline" />}
              <Link href={signedIn ? `/explore?tool=${selected.id}` : "/sign-up"} className={styles.floatCta}>
                {signedIn ? "View and request" : "Sign in to request"} <ArrowRight aria-hidden />
              </Link>
            </span>
            <button type="button" className={styles.floatClose} onClick={() => setSelectedId(null)} aria-label="Close">
              ×
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
