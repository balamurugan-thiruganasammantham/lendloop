"use client";

import clsx from "clsx";
import { ImagePlus, X } from "lucide-react";
import { useRef, useState } from "react";
import { useImageUpload, type UploadedImage } from "@/hooks/useImageUpload";
import { Spinner } from "./Spinner";
import styles from "./ImageUploader.module.scss";

/** Multi-image picker. The first image is the cover. Metadata is stripped before upload. */
export function ImageUploader({
  value,
  onChange,
  max,
  label = "Add photo",
  invalid,
}: {
  value: UploadedImage[];
  onChange: (next: UploadedImage[]) => void;
  max: number;
  label?: string;
  invalid?: boolean;
}) {
  const { upload, uploading } = useImageUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const room = max - value.length;
    const picked = Array.from(files).slice(0, room);
    if (files.length > room) setError(`You can add up to ${max} photos.`);
    const results: UploadedImage[] = [];
    for (const file of picked) {
      try {
        results.push(await upload(file));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
      }
    }
    if (results.length) onChange([...value, ...results]);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <div className={clsx(styles.grid, invalid && styles.invalid)}>
        {value.map((img, i) => (
          <div key={img.storageId} className={styles.tile}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local preview / storage URL */}
            <img src={img.previewUrl} alt={`Photo ${i + 1}`} />
            {i === 0 && <span className={styles.cover}>Cover</span>}
            <button type="button" className={styles.remove} aria-label={`Remove photo ${i + 1}`} onClick={() => onChange(value.filter((v) => v.storageId !== img.storageId))}>
              <X />
            </button>
          </div>
        ))}
        {value.length < max && (
          <button type="button" className={styles.add} onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? <Spinner size={18} /> : <ImagePlus aria-hidden />}
            <span>{uploading ? "Uploading…" : label}</span>
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple={max > 1}
        hidden
        onChange={(e) => void onFiles(e.target.files)}
      />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
