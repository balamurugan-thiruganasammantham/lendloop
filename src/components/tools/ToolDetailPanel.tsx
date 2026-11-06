"use client";

import clsx from "clsx";
import { useQuery } from "convex/react";
import { ArrowLeft, ArrowRight, BadgeCheck, CalendarClock, Clock, Link2, MapPin, ShieldCheck, Tag, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CATEGORY_LABELS, CONDITION_LABELS } from "@convex/lib/constants";
import { formatDistance, haversineKm, type LatLng } from "@convex/lib/geo";
import { Avatar } from "@/components/common/Avatar";
import { Button, IconButton } from "@/components/common/Button";
import { Rating } from "@/components/common/Stars";
import { EmptyState, LoadingState } from "@/components/common/States";
import { useToast } from "@/components/common/Toast";
import { LocationCta } from "@/features/discovery/LocationCta";
import { formatMoney, formatRange, memberSince, plural } from "@/lib/format";
import { ImageGallery } from "./ImageGallery";
import styles from "./ToolDetailPanel.module.scss";

export function ToolDetailPanel({
  toolId,
  from,
  onClose,
  onRequest,
}: {
  toolId: Id<"tools">;
  from: LatLng | null;
  onClose: () => void;
  onRequest: () => void;
}) {
  const tool = useQuery(api.tools.get, { toolId });
  const [now] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  const toast = useToast();

  const back = (
    <IconButton label="Back to list" onClick={onClose} variant="surface" size="sm" className={styles.back}>
      <ArrowLeft />
    </IconButton>
  );

  if (tool === undefined) {
    return (
      <div className={styles.panel}>
        <div className={styles.topBar}>{back}</div>
        <LoadingState label="Loading tool…" />
      </div>
    );
  }
  if (tool === null) {
    return (
      <div className={styles.panel}>
        <div className={styles.topBar}>{back}</div>
        <EmptyState title="This listing is no longer available" description="It may have been removed by its owner." />
      </div>
    );
  }

  const distance = from ? haversineKm(from, { lat: tool.approxLat, lng: tool.approxLng }) : null;
  const upcoming = tool.bookedRanges.filter((r) => r.returnBy > now);
  const rep = tool.owner.reputation;
  const reserved = tool.status === "RESERVED";
  const long = tool.description.length > 220;

  const share = async () => {
    const url = `${window.location.origin}/explore?tool=${tool.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied.");
    } catch {
      toast.info(url);
    }
  };

  return (
    <article className={styles.panel} aria-labelledby="tool-title">
      <div className={styles.scroll}>
        <div className={styles.hero}>
          <ImageGallery images={tool.images} category={tool.category} name={tool.name} credits={tool.imageCredits} />
          <div className={styles.heroBar}>
            {back}
            <IconButton label="Copy link" onClick={share} variant="surface" size="sm">
              <Link2 />
            </IconButton>
          </div>
        </div>

        <div className={styles.content}>
          <div className={styles.chips}>
            <span className={clsx(styles.chip, styles.live, reserved && styles.liveReserved)}>
              <span className={styles.dot} aria-hidden />
              {tool.discoverable ? (reserved ? "Some dates booked" : "Available now") : "Not available"}
            </span>
            <span className={styles.chip}>{CATEGORY_LABELS[tool.category]}</span>
            <span className={styles.chip}>{CONDITION_LABELS[tool.condition]} condition</span>
            {tool.isSeed && <span className={clsx(styles.chip, styles.sample)}>Sample</span>}
          </div>

          <h2 id="tool-title" className={clsx(styles.title, "display")}>
            {tool.name}
          </h2>
          <p className={styles.where}>
            <MapPin aria-hidden /> {tool.pickupArea}
            {distance !== null && <span className="num"> · ~{formatDistance(distance)} away</span>}
          </p>
          {distance === null && (
            <p className={styles.whereCta}>
              <LocationCta variant="inline" />
            </p>
          )}

          <p className={clsx(styles.description, !expanded && long && styles.clamped)}>{tool.description}</p>
          {long && (
            <button type="button" className={styles.readMore} onClick={() => setExpanded((e) => !e)}>
              {expanded ? "Show less" : "Read more"}
            </button>
          )}

          <h3 className={styles.eyebrow}>Tool details</h3>
          <div className={styles.tiles}>
            <div className={styles.tile}>
              <span className={styles.tileLabel}>
                <CalendarClock aria-hidden /> Max loan
              </span>
              <span className={styles.tileValue}>{plural(tool.maxLoanDays, "day")}</span>
            </div>
            <div className={styles.tile}>
              <span className={styles.tileLabel}>
                <Wallet aria-hidden /> Deposit
              </span>
              <span className={styles.tileValue}>{tool.depositAmount !== null ? `₹${formatMoney(tool.depositAmount)}` : "None"}</span>
            </div>
            <div className={clsx(styles.tile, styles.tileWide)}>
              <span className={styles.tileLabel}>
                <MapPin aria-hidden /> Pickup area
              </span>
              <span className={styles.tileValue}>{tool.pickupArea}</span>
              <span className={styles.tileNote}>Exact point shared after approval</span>
            </div>
          </div>

          <h3 className={styles.eyebrow}>Lender</h3>
          <Link href={`/users/${tool.owner.id}`} className={styles.lender}>
            <Avatar name={tool.owner.name} src={tool.owner.imageUrl} size={46} />
            <span className={styles.lenderText}>
              <span className={clsx(styles.lenderName, "display")}>
                {tool.owner.name}
                {tool.owner.trustedLender && <BadgeCheck aria-label="Trusted lender" className={styles.check} />}
              </span>
              <span className={styles.lenderMeta}>
                <Rating value={rep.averageRating} count={rep.reviewCount} /> · {plural(rep.verified.successfulLends, "completed lend")} · since{" "}
                {memberSince(tool.owner.memberSince)}
              </span>
            </span>
            <ArrowRight aria-hidden className={styles.arrow} />
          </Link>

          {upcoming.length > 0 && (
            <>
              <h3 className={styles.eyebrow}>Already booked</h3>
              <div className={styles.booked}>
                {upcoming.map((r) => (
                  <span key={r.pickupAt} className={styles.bookedChip}>
                    <Clock aria-hidden /> {formatRange(r.pickupAt, r.returnBy)}
                  </span>
                ))}
              </div>
            </>
          )}

          {tool.instructions && (
            <>
              <h3 className={styles.eyebrow}>Lending instructions</h3>
              <p className={styles.text}>{tool.instructions}</p>
            </>
          )}
          {tool.lendingTerms && (
            <>
              <h3 className={styles.eyebrow}>
                <Tag aria-hidden /> Conditions
              </h3>
              <p className={styles.text}>{tool.lendingTerms}</p>
            </>
          )}

          <p className={styles.privacy}>
            <ShieldCheck aria-hidden /> The map shows an approximate location. The exact pickup point is shared once the owner approves your request, and the
            hand-over is confirmed with a one-time code.
          </p>
        </div>
      </div>

      <footer className={styles.footer}>
        {tool.viewer.isOwner ? (
          <Link href={`/listings/${tool.id}/edit`} className={styles.footerLink}>
            This is your listing — edit it <ArrowRight aria-hidden />
          </Link>
        ) : tool.viewer.activeLoanId ? (
          <Link href={`/loans/${tool.viewer.activeLoanId}`} className={styles.footerLink}>
            View your loan <ArrowRight aria-hidden />
          </Link>
        ) : tool.viewer.pendingRequestId ? (
          <Link href="/requests?tab=PENDING" className={styles.footerLink}>
            Request pending — view it <ArrowRight aria-hidden />
          </Link>
        ) : tool.viewer.canRequest ? (
          <>
            <Link href={`/users/${tool.owner.id}`} className={styles.secondaryAction}>
              <Avatar name={tool.owner.name} src={tool.owner.imageUrl} size={22} /> {tool.owner.name.split(" ")[0]}
            </Link>
            <Button variant="primary" size="lg" className={styles.primaryAction} onClick={onRequest}>
              Request to borrow
            </Button>
          </>
        ) : (
          <p className={styles.unavailable}>Not available for new requests right now.</p>
        )}
      </footer>
    </article>
  );
}
