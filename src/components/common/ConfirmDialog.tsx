"use client";

import { useState, type ReactNode } from "react";
import { errorMessage } from "@/lib/errors";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { InlineAlert } from "./States";

/** Confirmation for consequential actions; surfaces server errors inline. */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  tone = "primary",
  onConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  onConfirm: () => Promise<unknown>;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setError(null);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      description={description}
      size="sm"
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                close();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    </Dialog>
  );
}
