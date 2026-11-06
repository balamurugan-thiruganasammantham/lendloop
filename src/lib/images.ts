/**
 * Client-side image preparation. Re-encoding through a canvas strips EXIF
 * metadata (including GPS coordinates that could reveal a home address) and
 * downsizes large photos before upload. The server still validates type/size.
 */
import { ALLOWED_IMAGE_TYPES, LIMITS } from "@convex/lib/constants";

const MAX_EDGE = 1600;

export class ImagePrepError extends Error {}

export async function prepareImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new ImagePrepError("Only image files can be uploaded.");
  if (file.size > 25 * 1024 * 1024) throw new ImagePrepError("That image is larger than 25 MB.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImagePrepError("This image format isn't supported. Try a JPEG or PNG.");
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImagePrepError("Your browser couldn't process this image.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new ImagePrepError("Your browser couldn't process this image.");
  if (blob.size > LIMITS.maxImageBytes) throw new ImagePrepError("This image is still larger than 5 MB after compression.");
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(blob.type)) throw new ImagePrepError("Unsupported image type.");
  return blob;
}
