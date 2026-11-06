"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import { LocateFixed } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "@convex/_generated/api";
import { LIMITS } from "@convex/lib/constants";
import { Button } from "@/components/common/Button";
import { Field, Input, Textarea } from "@/components/common/Field";
import { InlineAlert } from "@/components/common/States";
import { useToast } from "@/components/common/Toast";
import { errorMessage } from "@/lib/errors";
import { profileSchema, type ProfileValues } from "@/lib/validation";
import { reverseGeocode } from "@/services/maps";
import { useViewer } from "./ViewerContext";
import styles from "./ProfileForm.module.scss";

export function ProfileForm({ onboarding, onDone }: { onboarding?: boolean; onDone?: () => void }) {
  const viewer = useViewer();
  const update = useMutation(api.users.updateProfile);
  const toast = useToast();
  const [approx, setApprox] = useState<{ lat: number; lng: number } | null>(
    viewer.approxLat !== null && viewer.approxLng !== null ? { lat: viewer.approxLat, lng: viewer.approxLng } : null,
  );
  const [locating, setLocating] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: viewer.name, bio: viewer.bio, areaLabel: viewer.areaLabel, locationSharing: viewer.locationSharing },
  });

  const useCurrentArea = () => {
    if (!("geolocation" in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        // Coarsened again on the server; only ~1 km precision is ever stored.
        const p = { lat: Math.round(pos.coords.latitude * 100) / 100, lng: Math.round(pos.coords.longitude * 100) / 100 };
        setApprox(p);
        if (!getValues("areaLabel")) {
          const label = await reverseGeocode(p).catch(() => null);
          if (label) setValue("areaLabel", label.split(",").slice(0, 2).join(",").trim(), { shouldDirty: true });
        }
        setLocating(false);
      },
      () => {
        setLocating(false);
        toast.error("Couldn't get your location. You can type your neighbourhood instead.");
      },
      { timeout: 12_000 },
    );
  };

  const onSubmit = handleSubmit(async (v) => {
    setServerError(null);
    try {
      await update({
        name: v.name,
        bio: v.bio,
        areaLabel: v.areaLabel,
        locationSharing: v.locationSharing,
        approxLocation: approx,
        completeOnboarding: onboarding || undefined,
      });
      if (!onboarding) toast.success("Profile saved.");
      onDone?.();
    } catch (e) {
      setServerError(errorMessage(e));
    }
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <Field label="Display name" hint="Others see your first name and last initial." error={errors.name?.message}>
        {(id, d) => <Input id={id} aria-describedby={d} maxLength={LIMITS.nameMax} invalid={!!errors.name} {...register("name")} />}
      </Field>
      <Field label="Neighbourhood" optional hint="Shown on your profile, e.g. “Indiranagar”." error={errors.areaLabel?.message}>
        {(id, d) => (
          <div className={styles.inline}>
            <Input id={id} aria-describedby={d} maxLength={LIMITS.areaMax} {...register("areaLabel")} />
            <Button icon={<LocateFixed />} onClick={useCurrentArea} loading={locating}>
              Detect
            </Button>
          </div>
        )}
      </Field>
      {approx && (
        <p className={styles.note}>
          Approximate area saved (~1 km precision).{" "}
          <button type="button" onClick={() => setApprox(null)}>
            Remove
          </button>
        </p>
      )}
      <Field label="About you" optional hint="What do you lend? What do you often need?" error={errors.bio?.message}>
        {(id, d) => <Textarea id={id} aria-describedby={d} rows={3} maxLength={LIMITS.bioMax} {...register("bio")} />}
      </Field>
      <label className={styles.toggle}>
        <input type="checkbox" {...register("locationSharing")} />
        <span>
          <strong>Use my device location on the map</strong>
          <span>Used once per visit to centre the map and show distances. Never stored or shared. Turn off to always search by place.</span>
        </span>
      </label>
      {serverError && <InlineAlert tone="danger">{serverError}</InlineAlert>}
      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={isSubmitting} disabled={!onboarding && !isDirty && approx === null && viewer.approxLat === null}>
          {onboarding ? "Start exploring" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}
