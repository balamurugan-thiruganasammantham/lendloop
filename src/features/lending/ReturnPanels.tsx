"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LIMITS } from "@convex/lib/constants";
import { Button } from "@/components/common/Button";
import { Dialog } from "@/components/common/Dialog";
import { Field, Textarea } from "@/components/common/Field";
import { ImageUploader } from "@/components/common/ImageUploader";
import { InlineAlert } from "@/components/common/States";
import { useToast } from "@/components/common/Toast";
import type { UploadedImage } from "@/hooks/useImageUpload";
import { errorMessage } from "@/lib/errors";
import styles from "./LoanDetail.module.scss";

/** Borrower starts the return: current photo(s) + notes. */
export function ReturnForm({ loanId, ownerName }: { loanId: Id<"loans">; ownerName: string }) {
  const requestReturn = useMutation(api.loans.requestReturn);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<UploadedImage[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (photos.length === 0) {
      setError("Add a current photo of the tool.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await requestReturn({ loanId, photoIds: photos.map((p) => p.storageId), notes: notes.trim() || undefined });
      toast.success(`${ownerName} has been told you're ready to return it.`);
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={styles.actionCard}>
        <div>
          <h3>Done with it?</h3>
          <p>Take a current photo, add any notes, and let {ownerName} know you&apos;re ready to hand it back.</p>
        </div>
        <Button variant="primary" onClick={() => setOpen(true)}>
          Return item
        </Button>
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        busy={busy}
        title="Return item"
        description="Photos are compared with the original listing when the owner confirms."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={busy}>
              Confirm return request
            </Button>
          </>
        }
      >
        <div className={styles.dialogStack}>
          <div>
            <p className={styles.fieldLabel}>Current photo of the tool</p>
            <ImageUploader value={photos} onChange={setPhotos} max={LIMITS.returnPhotosMax} label="Add photo" />
          </div>
          <Field label="Return notes" optional>
            {(id) => <Textarea id={id} rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Charged both batteries; bits are in the case." />}
          </Field>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        </div>
      </Dialog>
    </>
  );
}

export function DamageDialog({ loanId, open, onClose }: { loanId: Id<"loans">; open: boolean; onClose: () => void }) {
  const report = useMutation(api.loans.reportDamage);
  const toast = useToast();
  const [evidence, setEvidence] = useState<UploadedImage[]>([]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await report({ loanId, description, evidenceIds: evidence.map((e) => e.storageId) });
      toast.info("Damage reported. The borrower has been notified.");
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title="Report damage"
      description="Describe what's wrong and add photo evidence. The borrower can acknowledge or contest it; contested reports go to an admin."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} loading={busy} disabled={description.trim().length < LIMITS.damageDescriptionMin || evidence.length === 0}>
            Submit report
          </Button>
        </>
      }
    >
      <div className={styles.dialogStack}>
        <Field label="What's damaged?" hint={`At least ${LIMITS.damageDescriptionMin} characters. Stick to facts.`}>
          {(id) => <Textarea id={id} rows={4} maxLength={LIMITS.damageDescriptionMax} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <div>
          <p className={styles.fieldLabel}>Evidence photos</p>
          <ImageUploader value={evidence} onChange={setEvidence} max={LIMITS.evidenceMax} label="Add evidence" />
        </div>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}

export function NotReturnedDialog({ loanId, open, onClose }: { loanId: Id<"loans">; open: boolean; onClose: () => void }) {
  const report = useMutation(api.loans.reportNotReturned);
  const toast = useToast();
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await report({ loanId, details });
      toast.info("Reported. An admin will review the case.");
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title="Report not returned"
      description="This opens a dispute for admin review and keeps the tool off the map until it's resolved. The borrower is notified."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} loading={busy} disabled={details.trim().length < 10}>
            Open dispute
          </Button>
        </>
      }
    >
      <div className={styles.dialogStack}>
        <Field label="What happened?" hint="Dates you tried to arrange the return, responses received, etc.">
          {(id) => <Textarea id={id} rows={4} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />}
        </Field>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}

export function DamageResponse({ reportId }: { reportId: Id<"damageReports"> }) {
  const respond = useMutation(api.loans.respondToDamage);
  const toast = useToast();
  const [contesting, setContesting] = useState(false);
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (response: "ACKNOWLEDGE" | "CONTEST") => {
    setBusy(true);
    setError(null);
    try {
      await respond({ reportId, response, statement: statement.trim() || undefined });
      toast.success(response === "ACKNOWLEDGE" ? "Thanks — the owner can now close the loan." : "Contested. An admin will review the evidence.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.dialogStack}>
      {contesting ? (
        <>
          <Field label="Why do you disagree?" hint="At least 10 characters. An admin will see both sides.">
            {(id) => <Textarea id={id} rows={3} maxLength={500} value={statement} onChange={(e) => setStatement(e.target.value)} />}
          </Field>
          <div className={styles.buttonRow}>
            <Button variant="ghost" onClick={() => setContesting(false)} disabled={busy}>
              Back
            </Button>
            <Button variant="danger" loading={busy} disabled={statement.trim().length < 10} onClick={() => void act("CONTEST")}>
              Contest report
            </Button>
          </div>
        </>
      ) : (
        <div className={styles.buttonRow}>
          <Button variant="primary" loading={busy} onClick={() => void act("ACKNOWLEDGE")}>
            Acknowledge damage
          </Button>
          <Button onClick={() => setContesting(true)}>Contest</Button>
        </div>
      )}
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    </div>
  );
}
