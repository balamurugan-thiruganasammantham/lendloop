"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import { LocateFixed, ShieldCheck } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CATEGORY_LABELS, CONDITION_LABELS, LIMITS, TOOL_CATEGORIES, TOOL_CONDITIONS } from "@convex/lib/constants";
import { Button } from "@/components/common/Button";
import { Field, Input, Select, Textarea } from "@/components/common/Field";
import { ImageUploader } from "@/components/common/ImageUploader";
import { InlineAlert } from "@/components/common/States";
import { useToast } from "@/components/common/Toast";
import { PlaceSearch } from "@/components/map/PlaceSearch";
import { useLocation } from "@/features/discovery/LocationProvider";
import type { UploadedImage } from "@/hooks/useImageUpload";
import { errorMessage } from "@/lib/errors";
import { combineDateTime, toDateInput } from "@/lib/format";
import { toolFormSchema, type ToolFormValues } from "@/lib/validation";
import { reverseGeocode } from "@/services/maps";
import styles from "./ToolForm.module.scss";

const LocationPickerMap = dynamic(() => import("@/components/map/LocationPickerMap"), {
  ssr: false,
  loading: () => <div className={styles.mapLoading}>Loading map…</div>,
});

export interface ToolFormInitial {
  id: Id<"tools">;
  values: ToolFormValues;
  images: UploadedImage[];
}

export function ToolForm({ initial }: { initial?: ToolFormInitial }) {
  const router = useRouter();
  const toast = useToast();
  const location = useLocation();
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const [images, setImages] = useState<UploadedImage[]>(initial?.images ?? []);
  const [imageError, setImageError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [today] = useState(() => toDateInput(Date.now()));

  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ToolFormValues>({
    resolver: zodResolver(toolFormSchema),
    defaultValues: initial?.values ?? {
      name: "",
      category: "POWER_TOOLS",
      condition: "GOOD",
      description: "",
      pickupArea: "",
      pickupAddress: "",
      instructions: "",
      lendingTerms: "",
      maxLoanDays: 3,
      availableFrom: "",
      availableUntil: "",
    },
  });

  const lat = useWatch({ control, name: "pickupLat" });
  const lng = useWatch({ control, name: "pickupLng" });
  const point = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

  const setPoint = async (p: { lat: number; lng: number }, label?: string) => {
    setValue("pickupLat", p.lat, { shouldValidate: true });
    setValue("pickupLng", p.lng, { shouldValidate: true });
    if (!getValues("pickupArea")) {
      const area = label ?? (await reverseGeocode(p).catch(() => null));
      if (area) setValue("pickupArea", area.split(",").slice(0, 2).join(",").trim(), { shouldValidate: true });
    }
  };

  const useCurrent = () => {
    if (!("geolocation" in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        void setPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setLocating(false);
        toast.error("Couldn't get your location. Click on the map to place the pickup point instead.");
      },
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  };

  const onSubmit = handleSubmit(async (v) => {
    setServerError(null);
    if (images.length === 0) {
      setImageError("Add at least one photo so borrowers know what to expect.");
      return;
    }
    const payload = {
      name: v.name,
      category: v.category,
      condition: v.condition,
      description: v.description,
      imageIds: images.map((i) => i.storageId),
      pickupArea: v.pickupArea,
      pickupLocation: { lat: v.pickupLat, lng: v.pickupLng },
      pickupAddress: v.pickupAddress || undefined,
      instructions: v.instructions || undefined,
      lendingTerms: v.lendingTerms || undefined,
      depositAmount: v.depositAmount !== undefined && Number.isFinite(v.depositAmount) ? v.depositAmount : undefined,
      maxLoanDays: v.maxLoanDays,
      availableFrom: v.availableFrom ? combineDateTime(v.availableFrom, "00:00") : undefined,
      availableUntil: v.availableUntil ? combineDateTime(v.availableUntil, "23:59") : undefined,
    };
    try {
      if (initial) {
        await update({ toolId: initial.id, ...payload });
        toast.success("Listing updated.");
      } else {
        await create(payload);
        toast.success("Your tool is live on the map.");
      }
      router.push("/listings");
    } catch (e) {
      setServerError(errorMessage(e));
    }
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <section className={styles.section}>
        <h2>The tool</h2>
        <Field label="Name" error={errors.name?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} placeholder="e.g. Cordless drill (18V)" maxLength={LIMITS.toolNameMax} invalid={!!errors.name} {...register("name")} />}
        </Field>
        <div className={styles.row}>
          <Field label="Category" error={errors.category?.message}>
            {(id, d) => (
              <Select id={id} aria-describedby={d} {...register("category")}>
                {TOOL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Condition" error={errors.condition?.message}>
            {(id, d) => (
              <Select id={id} aria-describedby={d} {...register("condition")}>
                {TOOL_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {CONDITION_LABELS[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Description" hint="What's included, quirks, what it's good for." error={errors.description?.message}>
          {(id, d) => <Textarea id={id} aria-describedby={d} rows={4} maxLength={LIMITS.descriptionMax} invalid={!!errors.description} {...register("description")} />}
        </Field>
        <div className={styles.field}>
          <span className={styles.label}>Photos</span>
          <ImageUploader
            value={images}
            max={LIMITS.maxImages}
            invalid={!!imageError}
            onChange={(next) => {
              setImages(next);
              if (next.length) setImageError(null);
            }}
          />
          <p className={imageError ? styles.error : styles.hint}>{imageError ?? "Up to 6 photos. Location metadata is removed before upload."}</p>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Pickup</h2>
        <p className={styles.privacy}>
          <ShieldCheck aria-hidden /> Your exact pickup point stays private. Others see an approximate area (~500 m) until you approve their request.
        </p>
        <div className={styles.pickerTools}>
          <div className={styles.placeSearch}>
            <PlaceSearch placeholder="Search your street or building" onPick={(p) => void setPoint({ lat: p.lat, lng: p.lng }, p.label)} />
          </div>
          <Button icon={<LocateFixed />} onClick={useCurrent} loading={locating}>
            Use my location
          </Button>
        </div>
        <div className={styles.picker}>
          <LocationPickerMap value={point} onChange={(p) => void setPoint(p)} fallback={location.point} />
        </div>
        <p className={errors.pickupLat ? styles.error : styles.hint}>
          {errors.pickupLat ? "Click the map to set the pickup point." : point ? "Drag the pin to adjust." : "Click the map to place the pickup pin."}
        </p>
        <div className={styles.row}>
          <Field label="Neighbourhood (public)" hint="Shown on your listing, e.g. “Indiranagar, Bengaluru”." error={errors.pickupArea?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} maxLength={LIMITS.areaMax} invalid={!!errors.pickupArea} {...register("pickupArea")} />}
          </Field>
          <Field label="Address / landmark (private)" optional hint="Only shared with an approved borrower." error={errors.pickupAddress?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} maxLength={LIMITS.addressMax} {...register("pickupAddress")} />}
          </Field>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Lending terms</h2>
        <div className={styles.row3}>
          <Field label="Max loan (days)" error={errors.maxLoanDays?.message}>
            {(id, d) => (
              <Input id={id} aria-describedby={d} type="number" min={1} max={LIMITS.maxLoanDaysCeiling} invalid={!!errors.maxLoanDays} {...register("maxLoanDays", { valueAsNumber: true })} />
            )}
          </Field>
          <Field label="Available from" optional error={errors.availableFrom?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} type="date" min={today} {...register("availableFrom")} />}
          </Field>
          <Field label="Available until" optional error={errors.availableUntil?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} type="date" invalid={!!errors.availableUntil} {...register("availableUntil")} />}
          </Field>
        </div>
        <Field label="Lending instructions" optional hint="E.g. how to charge it, what to bring back." error={errors.instructions?.message}>
          {(id, d) => <Textarea id={id} aria-describedby={d} rows={3} maxLength={LIMITS.instructionsMax} {...register("instructions")} />}
        </Field>
        <div className={styles.row}>
          <Field label="Conditions" optional hint="Any rules for borrowers." error={errors.lendingTerms?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} maxLength={LIMITS.termsMax} {...register("lendingTerms")} />}
          </Field>
          <Controller
            control={control}
            name="depositAmount"
            render={({ field }) => (
              <Field label="Refundable deposit (₹)" optional hint="Informational — LendLoop doesn't handle payments.">
                {(id, d) => (
                  <Input
                    id={id}
                    aria-describedby={d}
                    type="number"
                    min={0}
                    step={100}
                    value={field.value === undefined || Number.isNaN(field.value) ? "" : field.value}
                    onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                  />
                )}
              </Field>
            )}
          />
        </div>
      </section>

      {serverError && <InlineAlert tone="danger">{serverError}</InlineAlert>}
      <div className={styles.actions}>
        <Button variant="ghost" onClick={() => router.back()} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" loading={isSubmitting}>
          {initial ? "Save changes" : "Publish listing"}
        </Button>
      </div>
    </form>
  );
}
