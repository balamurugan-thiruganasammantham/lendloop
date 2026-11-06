"use client";

import { useMutation } from "convex/react";
import { useCallback, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toClientError } from "@/lib/errors";
import { ImagePrepError, prepareImage } from "@/lib/images";

export interface UploadedImage {
  storageId: Id<"_storage">;
  previewUrl: string;
}

/**
 * Upload flow: strip metadata client-side → short-lived upload URL →
 * direct upload to Convex storage → register ownership server-side.
 */
export function useImageUpload() {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const registerUpload = useMutation(api.files.registerUpload);
  const [uploading, setUploading] = useState(0);

  const upload = useCallback(
    async (file: File): Promise<UploadedImage> => {
      setUploading((n) => n + 1);
      try {
        const blob = await prepareImage(file);
        const url = await generateUploadUrl();
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        const result = await registerUpload({ storageId });
        if (result && "rejected" in result) throw new ImagePrepError(result.message);
        return { storageId, previewUrl: URL.createObjectURL(blob) };
      } catch (error) {
        if (error instanceof ImagePrepError) throw error;
        const client = toClientError(error);
        throw new ImagePrepError(client.code === "UNKNOWN" ? "The image could not be uploaded. Please try again." : client.message);
      } finally {
        setUploading((n) => n - 1);
      }
    },
    [generateUploadUrl, registerUpload],
  );

  return { upload, uploading: uploading > 0 };
}
