"use client";

import clsx from "clsx";
import { useMutation } from "convex/react";
import { Flag } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { BORROWER_ONLY_TAGS, FEEDBACK_TAG_LABELS, FEEDBACK_TAGS, OWNER_ONLY_TAGS, type FeedbackTag } from "@convex/lib/constants";
import { Button } from "@/components/common/Button";
import { Dialog } from "@/components/common/Dialog";
import { Field, Textarea } from "@/components/common/Field";
import { Rating, StarInput } from "@/components/common/Stars";
import { InlineAlert } from "@/components/common/States";
import { useToast } from "@/components/common/Toast";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import styles from "./FeedbackSection.module.scss";

interface FeedbackView {
  rating: number;
  comment: string | null;
  tags: FeedbackTag[];
  createdAt: number;
}

export function FeedbackSection({
  loanId,
  role,
  counterpartName,
  mine,
  theirs,
  canLeave,
}: {
  loanId: Id<"loans">;
  role: "BORROWER" | "OWNER";
  counterpartName: string;
  mine: FeedbackView | null;
  theirs: (FeedbackView & { id: Id<"feedback"> }) | null;
  canLeave: boolean;
}) {
  const submit = useMutation(api.feedback.submit);
  const report = useMutation(api.feedback.report);
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState<FeedbackTag[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");

  const excluded = role === "BORROWER" ? OWNER_ONLY_TAGS : BORROWER_ONLY_TAGS;
  const options = FEEDBACK_TAGS.filter((t) => !excluded.includes(t));
  const toggle = (t: FeedbackTag) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : cur.length >= 5 ? cur : [...cur, t]));

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await submit({ loanId, rating, comment: comment.trim() || undefined, tags });
      toast.success("Thanks for your feedback.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section} id="feedback" aria-labelledby="fb-heading">
      <h2 id="fb-heading" className={styles.heading}>
        Feedback
      </h2>
      {mine ? (
        <Review title="You wrote" review={mine} />
      ) : canLeave ? (
        <div className={styles.form}>
          <p className={styles.prompt}>How was {role === "BORROWER" ? "borrowing from" : "lending to"} {counterpartName}?</p>
          <StarInput value={rating} onChange={setRating} />
          <div className={styles.tags} role="group" aria-label="Tags">
            {options.map((t) => (
              <button key={t} type="button" aria-pressed={tags.includes(t)} className={clsx(styles.tag, tags.includes(t) && styles.tagOn)} onClick={() => toggle(t)}>
                {FEEDBACK_TAG_LABELS[t]}
              </button>
            ))}
          </div>
          <Field label="Comment" optional hint="Be specific and fair — this is public on their profile.">
            {(id) => <Textarea id={id} rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />}
          </Field>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
          <div>
            <Button variant="primary" onClick={send} loading={busy} disabled={rating === 0}>
              Submit feedback
            </Button>
          </div>
        </div>
      ) : null}
      {theirs ? (
        <div className={styles.theirs}>
          <Review title={`${counterpartName} wrote about you`} review={theirs} />
          <button type="button" className={styles.report} onClick={() => setReporting(true)}>
            <Flag aria-hidden /> Report this feedback
          </button>
        </div>
      ) : (
        <p className={styles.muted}>{counterpartName} hasn&apos;t left feedback yet.</p>
      )}
      <Dialog
        open={reporting}
        onClose={() => setReporting(false)}
        title="Report feedback"
        description="Report reviews that are abusive, false or unrelated to the loan. An admin will review it; the review stays visible meanwhile."
        size="sm"
        busy={busy}
        footer={
          <Button
            variant="danger"
            loading={busy}
            disabled={reason.trim().length < 10}
            onClick={async () => {
              if (!theirs) return;
              setBusy(true);
              try {
                await report({ feedbackId: theirs.id, reason });
                toast.success("Report sent to the admins.");
                setReporting(false);
              } catch (e) {
                toast.error(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Send report
          </Button>
        }
      >
        <Field label="What's wrong with it?" hint="At least 10 characters.">
          {(id) => <Textarea id={id} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </Dialog>
    </section>
  );
}

function Review({ title, review }: { title: string; review: FeedbackView }) {
  return (
    <div className={styles.review}>
      <p className={styles.reviewTitle}>
        {title} · <span className={styles.muted}>{formatDate(review.createdAt)}</span>
      </p>
      <Rating value={review.rating} size="md" />
      {review.comment && <p className={styles.comment}>{review.comment}</p>}
      {review.tags.length > 0 && (
        <div className={styles.tags}>
          {review.tags.map((t) => (
            <span key={t} className={styles.tagStatic}>
              {FEEDBACK_TAG_LABELS[t]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
