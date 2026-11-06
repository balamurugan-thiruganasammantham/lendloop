"use client";

import { useAction } from "convex/react";
import { KeyRound, RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { OTP_CONFIG, type OtpPurpose } from "@convex/lib/constants";
import { Button } from "@/components/common/Button";
import { InlineAlert } from "@/components/common/States";
import { useToast } from "@/components/common/Toast";
import { toClientError } from "@/lib/errors";
import { formatTime } from "@/lib/format";
import styles from "./LoanDetail.module.scss";

function useCountdown(until: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [until]);
  if (!until) return null;
  const left = Math.max(0, until - now);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return { left, label: left > 3_600_000 ? `until ${formatTime(until)}` : `${m}:${String(s).padStart(2, "0")}` };
}

interface OtpMeta {
  expiresAt: number;
  expired: boolean;
  attemptsRemaining: number;
}

/**
 * Borrower side: reveal a one-time code to read out in person. Generating a
 * code invalidates any earlier one; the plaintext is shown only here.
 */
export function ShowCodePanel({ loanId, purpose, ownerName, meta }: { loanId: Id<"loans">; purpose: OtpPurpose; ownerName: string; meta: OtpMeta | null }) {
  const requestCode = useAction(api.otpActions.requestCode);
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const countdown = useCountdown(code?.expiresAt ?? null);
  const expired = countdown !== null && countdown.left === 0;
  const noun = purpose === "COLLECTION" ? "pickup" : "return";

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      setCode(await requestCode({ loanId, purpose }));
    } catch (e) {
      setError(toClientError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.codePanel}>
      <div className={styles.codeHead}>
        <KeyRound aria-hidden />
        <div>
          <h3>Your {noun} code</h3>
          <p>
            Meet {ownerName}, check the tool, then read this code out loud. {ownerName} enters it to confirm the {noun}. Never send it
            by message.
          </p>
        </div>
      </div>
      {code && !expired ? (
        <div className={styles.codeBox} aria-live="polite">
          <span className={styles.code} aria-label={`Code ${code.code.split("").join(" ")}`}>
            {code.code.slice(0, 3)}&nbsp;{code.code.slice(3)}
          </span>
          <span className={styles.codeMeta}>Valid {countdown?.label} · single use</span>
        </div>
      ) : (
        <div className={styles.codeEmpty}>
          {expired ? "That code expired." : meta && !meta.expired ? "A code was sent to your email." : "No code shown yet."}
        </div>
      )}
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      <Button variant={code && !expired ? "secondary" : "primary"} icon={code ? <RotateCcw /> : <KeyRound />} loading={busy} onClick={generate}>
        {code && !expired ? "Generate a new code" : `Show ${noun} code`}
      </Button>
      <p className={styles.fine}>Showing a new code invalidates any code sent earlier.</p>
    </div>
  );
}

/** Owner side: enter the code the borrower reads out. */
export function VerifyCodePanel({
  loanId,
  purpose,
  borrowerName,
  meta,
  onVerified,
}: {
  loanId: Id<"loans">;
  purpose: OtpPurpose;
  borrowerName: string;
  meta: OtpMeta | null;
  onVerified?: () => void;
}) {
  const verify = useAction(api.otpActions.verifyCode);
  const toast = useToast();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; attempts?: number } | null>(null);
  const noun = purpose === "COLLECTION" ? "pickup" : "return";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verify({ loanId, purpose, code: value });
      setValue("");
      toast.success(purpose === "COLLECTION" ? "Pickup confirmed. The loan is now active." : "Return confirmed. The loan is complete.");
      onVerified?.();
    } catch (err) {
      const c = toClientError(err);
      setError({ message: c.message, attempts: typeof c.data.attemptsRemaining === "number" ? c.data.attemptsRemaining : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.codePanel} onSubmit={submit}>
      <div className={styles.codeHead}>
        <ShieldCheck aria-hidden />
        <div>
          <h3>Confirm the {noun}</h3>
          <p>
            {purpose === "COLLECTION"
              ? `Check it's ${borrowerName} in person, then ask them to read their pickup code from the LendLoop app.`
              : `Check the tool is complete and undamaged, then ask ${borrowerName} for their return code.`}
          </p>
        </div>
      </div>
      <label className="visually-hidden" htmlFor={`otp-${purpose}`}>
        {OTP_CONFIG.digits}-digit code
      </label>
      <input
        id={`otp-${purpose}`}
        className={styles.otpInput}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        placeholder="000 000"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^\d ]/g, ""))}
      />
      {meta && (
        <p className={styles.fine}>
          {meta.expired
            ? "The current code has expired — ask the borrower to generate a new one."
            : `${meta.attemptsRemaining} attempt${meta.attemptsRemaining === 1 ? "" : "s"} left for the current code.`}
        </p>
      )}
      {!meta && <p className={styles.fine}>No active code yet — the borrower can generate one in their app.</p>}
      {error && (
        <InlineAlert tone="danger">
          {error.message}
          {error.attempts !== undefined && error.attempts > 0 && ` ${error.attempts} attempt${error.attempts === 1 ? "" : "s"} left.`}
        </InlineAlert>
      )}
      <Button type="submit" variant="primary" loading={busy} disabled={value.replace(/\D/g, "").length !== OTP_CONFIG.digits}>
        Verify {noun}
      </Button>
    </form>
  );
}
