"use client";

import { useQuery } from "@tanstack/react-query";
import { MapPin, Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { searchPlaces, type PlaceResult } from "@/services/maps";
import styles from "./PlaceSearch.module.scss";

/** Neighbourhood/place search backed by the geocoding proxy. */
export function PlaceSearch({ onPick, autoFocus, placeholder = "Search a neighbourhood or address" }: { onPick: (p: PlaceResult) => void; autoFocus?: boolean; placeholder?: string }) {
  const [value, setValue] = useState("");
  const [debounced, setDebounced] = useState("");
  const listId = useId();
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value.trim()), 350);
    return () => window.clearTimeout(t);
  }, [value]);
  const query = useQuery({
    queryKey: ["places", debounced],
    queryFn: () => searchPlaces(debounced),
    enabled: debounced.length >= 3,
  });

  return (
    <div className={styles.wrap}>
      <div className={styles.field}>
        <Search aria-hidden />
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-controls={listId}
          autoFocus={autoFocus}
          maxLength={120}
        />
      </div>
      {debounced.length >= 3 && (
        <ul id={listId} className={styles.results} role="listbox">
          {query.isLoading && <li className={styles.note}>Searching…</li>}
          {query.isError && <li className={styles.note}>Place search is unavailable right now. Try again shortly.</li>}
          {query.data?.length === 0 && <li className={styles.note}>No places found.</li>}
          {query.data?.map((p) => (
            <li key={`${p.lat},${p.lng}`}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onPick(p);
                  setValue("");
                }}
              >
                <MapPin aria-hidden /> {p.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
