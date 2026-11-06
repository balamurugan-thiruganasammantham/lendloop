"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { rangesOverlap } from "@convex/lib/rules";
import { Button } from "@/components/common/Button";
import { Dialog } from "@/components/common/Dialog";
import { Field, Input, Textarea } from "@/components/common/Field";
import { InlineAlert } from "@/components/common/States";
import { errorMessage } from "@/lib/errors";
import { combineDateTime, formatDateTime, formatDuration, formatRange, toDateInput } from "@/lib/format";
import { borrowRequestSchema, type BorrowRequestValues } from "@/lib/validation";
import styles from "./BorrowRequestModal.module.scss";

export interface BorrowTarget {
  id: Id<"tools">;
  name: string;
  ownerName: string;
  maxLoanDays: number;
  bookedRanges: { pickupAt: number; returnBy: number }[];
}

export function BorrowRequestModal({ tool, open, onClose }: { tool: BorrowTarget; open: boolean; onClose: () => void }) {
  const create = useMutation(api.requests.create);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ pickupAt: number; returnBy: number } | null>(null);

  // Computed once per mount: "tomorrow at 10:00" for up to two days.
  const [today] = useState(() => toDateInput(Date.now()));
  const [defaults] = useState<BorrowRequestValues>(() => {
    const start = new Date(Date.now() + 24 * 3600 * 1000);
    const end = new Date(start.getTime() + Math.min(tool.maxLoanDays, 2) * 24 * 3600 * 1000);
    return { startDate: toDateInput(start.getTime()), pickupTime: "10:00", endDate: toDateInput(end.getTime()), returnTime: "10:00", message: "" };
  });

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<BorrowRequestValues>({ resolver: zodResolver(borrowRequestSchema(tool.maxLoanDays)), defaultValues: defaults });

  const values = useWatch({ control });
  const pickupAt = values.startDate && values.pickupTime ? combineDateTime(values.startDate, values.pickupTime) : NaN;
  const returnBy = values.endDate && values.returnTime ? combineDateTime(values.endDate, values.returnTime) : NaN;
  const valid = Number.isFinite(pickupAt) && Number.isFinite(returnBy) && returnBy > pickupAt;
  const clash = valid ? tool.bookedRanges.find((r) => rangesOverlap(pickupAt, returnBy, r.pickupAt, r.returnBy)) : undefined;

  const close = () => {
    setSubmitted(null);
    setServerError(null);
    reset(defaults);
    onClose();
  };

  const onSubmit = handleSubmit(async (v) => {
    setServerError(null);
    const p = combineDateTime(v.startDate, v.pickupTime);
    const r = combineDateTime(v.endDate, v.returnTime);
    try {
      await create({ toolId: tool.id, pickupAt: p, returnBy: r, message: v.message?.trim() || undefined });
      setSubmitted({ pickupAt: p, returnBy: r });
    } catch (e) {
      setServerError(errorMessage(e));
    }
  });

  if (submitted) {
    return (
      <Dialog open={open} onClose={close} title="Request sent" glass size="sm">
        <div className={styles.success}>
          <CircleCheck aria-hidden />
          <p>
            We&apos;ve let {tool.ownerName} know you&apos;d like to borrow the <strong>{tool.name}</strong> for{" "}
            {formatRange(submitted.pickupAt, submitted.returnBy)}.
          </p>
          <p className={styles.muted}>You&apos;ll be notified as soon as they respond. The exact pickup point is shared after approval.</p>
          <div className={styles.successActions}>
            <Link href="/requests?tab=PENDING" className={styles.primaryLink}>
              View my requests
            </Link>
            <Button variant="ghost" onClick={close}>
              Keep browsing
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      busy={isSubmitting}
      glass
      title={`Borrow ${tool.name}`}
      description={`From ${tool.ownerName} · up to ${tool.maxLoanDays} day${tool.maxLoanDays === 1 ? "" : "s"}`}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="borrow-form" loading={isSubmitting} disabled={!!clash}>
            Send request
          </Button>
        </>
      }
    >
      <form id="borrow-form" className={styles.form} onSubmit={onSubmit} noValidate>
        <div className={styles.row}>
          <Field label="Pick-up date" error={errors.startDate?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} type="date" min={today} invalid={!!errors.startDate} {...register("startDate")} />}
          </Field>
          <Field label="Pick-up time" error={errors.pickupTime?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} type="time" step={900} invalid={!!errors.pickupTime} {...register("pickupTime")} />}
          </Field>
        </div>
        <div className={styles.row}>
          <Field label="Return date" error={errors.endDate?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} type="date" min={values.startDate} invalid={!!errors.endDate} {...register("endDate")} />}
          </Field>
          <Field label="Return time" error={errors.returnTime?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} type="time" step={900} invalid={!!errors.returnTime} {...register("returnTime")} />}
          </Field>
        </div>
        {valid && !clash && (
          <p className={styles.summary}>
            {formatDateTime(pickupAt)} → {formatDateTime(returnBy)} · <span className="num">{formatDuration(returnBy - pickupAt)}</span>
          </p>
        )}
        {clash && (
          <InlineAlert tone="warn">
            Those dates overlap an existing booking ({formatRange(clash.pickupAt, clash.returnBy)}). Choose different dates.
          </InlineAlert>
        )}
        <Field label="Message to owner" optional hint="Say what it's for and when you can meet." error={errors.message?.message}>
          {(id, d) => <Textarea id={id} aria-describedby={d} rows={3} maxLength={500} placeholder="Hi! I'd like to put up some shelves this weekend…" {...register("message")} />}
        </Field>
        {serverError && <InlineAlert tone="danger">{serverError}</InlineAlert>}
      </form>
    </Dialog>
  );
}
