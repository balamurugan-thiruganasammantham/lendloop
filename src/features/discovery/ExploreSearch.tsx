"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { MapPin, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { searchPlaces, type PlaceResult } from "@/services/maps";
import styles from "./ExploreSearch.module.scss";

/**
 * One search box for tools (filters the list as you type) and places
 * (suggestions to move the map), with the filters button beside it.
 */
export function ExploreSearch({
  value,
  onChange,
  onPickPlace,
  onOpenFilters,
  filterCount,
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  onPickPlace: (p: PlaceResult) => void;
  onOpenFilters: () => void;
  filterCount: number;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [debounced, setDebounced] = useState(value.trim());
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value.trim()), 350);
    return () => window.clearTimeout(t);
  }, [value]);
  const places = useQuery({ queryKey: ["places", debounced], queryFn: () => searchPlaces(debounced), enabled: focused && debounced.length >= 3 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const showPlaces = focused && debounced.length >= 3;
  return (
    <div className={clsx(styles.row, compact && styles.compact)}>
      <div className={styles.field}>
        <Search aria-hidden className={styles.icon} />
        <input
          ref={inputRef}
          type="search"
          role="searchbox"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          placeholder={compact ? "Search tools or places…" : "Search tools, categories, places"}
          aria-label="Search tools or categories"
          maxLength={80}
        />
        {value ? (
          <button type="button" className={styles.clear} aria-label="Clear search" onClick={() => onChange("")}>
            <X />
          </button>
        ) : (
          !compact && <kbd className={styles.kbd}>/</kbd>
        )}
        {showPlaces && (
          <div className={styles.dropdown} role="listbox" aria-label="Places">
            <p className={styles.dropLabel}>Places</p>
            {places.isLoading && <p className={styles.dropNote}>Searching places…</p>}
            {places.isError && <p className={styles.dropNote}>Place search is unavailable right now.</p>}
            {places.data?.length === 0 && <p className={styles.dropNote}>No places match “{debounced}”.</p>}
            {places.data?.slice(0, 5).map((p) => (
              <button
                key={`${p.lat},${p.lng}`}
                type="button"
                role="option"
                aria-selected={false}
                className={styles.place}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPickPlace(p);
                  onChange("");
                  inputRef.current?.blur();
                }}
              >
                <MapPin aria-hidden /> <span>{p.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" className={clsx(styles.filters, filterCount > 0 && styles.filtersOn)} onClick={onOpenFilters} aria-label={`Filters${filterCount ? ` (${filterCount} active)` : ""}`}>
        <SlidersHorizontal aria-hidden />
        {filterCount > 0 && <span className={clsx(styles.badge, "num")}>{filterCount}</span>}
      </button>
    </div>
  );
}
