"use client";

import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { ToolCategory } from "@convex/lib/constants";
import { ToolThumb } from "@/components/common/ToolThumb";
import styles from "./ImageGallery.module.scss";

export interface ImageCredit {
  creator: string;
  license: string;
  sourceUrl: string;
}

export function ImageGallery({ images, category, name, credits = [] }: { images: string[]; category: ToolCategory; name: string; credits?: ImageCredit[] }) {
  const [index, setIndex] = useState(0);
  if (images.length === 0) {
    return (
      <div className={styles.gallery}>
        <ToolThumb src={null} category={category} size="fill" />
      </div>
    );
  }
  const go = (d: number) => setIndex((i) => (i + d + images.length) % images.length);
  return (
    <div className={styles.gallery}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Convex storage URLs */}
      <img src={images[index]} alt={`${name} — photo ${index + 1} of ${images.length}`} />
      {credits[index] && (
        <a className={styles.credit} href={credits[index].sourceUrl} target="_blank" rel="noopener noreferrer">
          Photo: {credits[index].creator} · {credits[index].license}
        </a>
      )}
      {images.length > 1 && (
        <>
          <button type="button" className={clsx(styles.nav, styles.prev)} onClick={() => go(-1)} aria-label="Previous photo">
            <ChevronLeft />
          </button>
          <button type="button" className={clsx(styles.nav, styles.next)} onClick={() => go(1)} aria-label="Next photo">
            <ChevronRight />
          </button>
          <div className={styles.dots}>
            {images.map((_, i) => (
              <button key={i} type="button" className={clsx(i === index && styles.on)} aria-label={`Photo ${i + 1}`} onClick={() => setIndex(i)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
