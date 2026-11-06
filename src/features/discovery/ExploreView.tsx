"use client";

import clsx from "clsx";
import { useQuery } from "convex/react";
import { ArrowLeft, ChevronRight, Compass, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CATEGORY_LABELS, type ToolCategory } from "@convex/lib/constants";
import { formatDistance, haversineKm } from "@convex/lib/geo";
import { Logo } from "@/components/brand/Logo";
import { BottomSheet, type SheetSnap } from "@/components/common/BottomSheet";
import { Button, IconButton } from "@/components/common/Button";
import { Dialog } from "@/components/common/Dialog";
import { EmptyState, LoadingState } from "@/components/common/States";
import { FiltersPanel } from "@/components/tools/FiltersPanel";
import { ToolCard } from "@/components/tools/ToolCard";
import { ToolDetailPanel } from "@/components/tools/ToolDetailPanel";
import { BorrowRequestModal } from "@/features/borrowing/BorrowRequestModal";
import { MOBILE_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { plural } from "@/lib/format";
import { sortByDistance, withLiveDistances } from "@/lib/location";
import { CategoryChips } from "./CategoryChips";
import { CategoryGrid } from "./CategoryGrid";
import { ExploreSearch } from "./ExploreSearch";
import { activeFilterCount, DEFAULT_FILTERS, type DiscoveryFilters } from "./filters";
import { LocationBanner } from "./LocationCta";
import { useLocation } from "./LocationProvider";
import { LocationPrompt } from "./LocationPrompt";
import { MapCarousel } from "./MapCarousel";
import { useAreaLabel } from "./useAreaLabel";
import { ViewToggle, type ExploreViewMode } from "./ViewToggle";
import styles from "./ExploreView.module.scss";

const ExploreMap = dynamic(() => import("@/components/map/ExploreMap"), {
  ssr: false,
  loading: () => <div className={styles.mapLoading} />,
});

/** Round the centre before sending it to the server (~110 m); distances are approximate anyway. */
function roundCenter(p: { lat: number; lng: number }) {
  return {
    lat: Math.round(p.lat * 1000) / 1000,
    lng: Math.round(p.lng * 1000) / 1000,
  };
}

const SHEET_PEEK = 128;

export function ExploreView() {
  const location = useLocation();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useMediaQuery(MOBILE_QUERY);

  // URL is the source of truth for the search text and the selected tool.
  const urlQ = params.get("q") ?? "";
  const [query, setQuery] = useState(urlQ);
  const [syncedQ, setSyncedQ] = useState(urlQ);
  if (urlQ !== syncedQ) {
    setSyncedQ(urlQ);
    setQuery(urlQ);
  }
  const selectedParam = params.get("tool");
  const [selectedId, setSelectedId] = useState<string | null>(selectedParam);
  const [syncedParam, setSyncedParam] = useState(selectedParam);
  if (selectedParam !== syncedParam) {
    setSyncedParam(selectedParam);
    setSelectedId(selectedParam);
  }

  // One filter state for the category chips, the "Available now" chip and the Filters dialog.
  const [filters, setFilters] = useState<DiscoveryFilters>(DEFAULT_FILTERS);
  const category = filters.category;
  const availableOnly = filters.availableNowOnly;
  const setCategory = useCallback((c: ToolCategory | "ALL") => setFilters((f) => ({ ...f, category: c })), []);
  const setAvailableOnly = useCallback((v: boolean) => setFilters((f) => ({ ...f, availableNowOnly: v })), []);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [snap, setSnap] = useState<SheetSnap>("half");
  const [recenterTick, setRecenterTick] = useState(0);
  const [viewportHeight] = useState(() => (typeof window === "undefined" ? 800 : window.innerHeight));
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const listRef = useRef<HTMLDivElement>(null);

  const replaceParams = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      mutate(next);
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, {
        scroll: false,
      });
    },
    [params, pathname, router],
  );

  // Map or List (cards grid) view; kept in the URL so refresh/back keep it.
  const view: ExploreViewMode = params.get("view") === "list" ? "list" : "map";
  const setView = useCallback((v: ExploreViewMode) => replaceParams((p) => (v === "list" ? p.set("view", "list") : p.delete("view"))), [replaceParams]);
  const listView = view === "list";

  // Debounced write of the search text to the URL.
  useEffect(() => {
    if (query === urlQ) return;
    const t = window.setTimeout(() => replaceParams((p) => (query.trim() ? p.set("q", query.trim()) : p.delete("q"))), 300);
    return () => window.clearTimeout(t);
  }, [query, urlQ, replaceParams]);

  const point = location.point;
  const center = useMemo(() => (point ? roundCenter(point) : undefined), [point]);
  const sort = !point && filters.sort === "nearest" ? "recent" : filters.sort;
  const radius = point && filters.radiusKm !== "ANY" ? filters.radiusKm : undefined;
  const search = urlQ.trim();

  const result = useQuery(api.tools.discover, {
    center,
    radiusKm: radius,
    conditions: filters.conditions.length ? filters.conditions : undefined,
    trustedOnly: filters.trustedOnly || undefined,
    search: search.length >= 2 ? search : undefined,
    sort,
  });

  // Distances are recomputed from the viewer's exact (live) position; the server only sees a rounded centre.
  // Category and availability chips filter client-side so every chip shows a live count.
  const all = useMemo(() => {
    const live = withLiveDistances(result?.items ?? [], point);
    return point && sort === "nearest" ? sortByDistance(live) : live;
  }, [result, point, sort]);
  const counts = useMemo(() => {
    const c: Partial<Record<ToolCategory, number>> = {};
    for (const i of all) c[i.category] = (c[i.category] ?? 0) + 1;
    return c;
  }, [all]);
  const availableCount = all.filter((i) => i.status !== "RESERVED").length;
  // Availability applies to everything (category cards included); the category narrows the tool list.
  const visible = availableOnly ? all.filter((i) => i.status !== "RESERVED") : all;
  const items = category === "ALL" ? visible : visible.filter((i) => i.category === category);
  const showCategoryIndex = category === "ALL" && !search;

  const selectTool = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      replaceParams((p) => (id ? p.set("tool", id) : p.delete("tool")));
      if (id && isMobile) setSnap("full");
      if (!id) listRef.current?.scrollTo({ top: 0 });
    },
    [replaceParams, isMobile],
  );

  const { area, city } = useAreaLabel(location.state);
  const title = area ?? (location.state.status === "ready" ? "Near you" : "All neighbourhoods");
  const detail = useQuery(api.tools.get, selectedId ? { toolId: selectedId as Id<"tools"> } : "skip");

  const locate = () => {
    location.requestGps();
    setRecenterTick((t) => t + 1);
  };

  const filterCount = activeFilterCount(filters);
  const head = (
    <header className={styles.head}>
      <div className={styles.crumbRow}>
        <nav className={styles.crumbs} aria-label="Location">
          <span>{city ?? "LendLoop"}</span>
          <ChevronRight aria-hidden />
          <span className={styles.crumbCurrent}>{area ?? (point ? "Nearby" : "Everywhere")}</span>
        </nav>
        {!isMobile && (
          <div className={styles.headActions}>
            <ViewToggle value={view} onChange={setView} />
            <IconButton label="Hide panel" size="sm" onClick={() => setPanelOpen(false)}>
              <PanelLeftClose />
            </IconButton>
          </div>
        )}
      </div>
      <h1 className={clsx(styles.title, "display")}>{search ? `“${search}”` : category !== "ALL" ? CATEGORY_LABELS[category] : title}</h1>
      <p className={styles.stats}>
        {result === undefined ? (
          "Finding tools…"
        ) : (
          <>
            <strong className="num">{result.total}</strong> {result.total === 1 ? "tool" : "tools"} · <strong className="num">{availableCount}</strong>{" "}
            available now
            {radius ? ` · within ${radius} km` : ""}
          </>
        )}
      </p>
      {!isMobile && (
        <ExploreSearch
          value={query}
          onChange={setQuery}
          onPickPlace={(p) => location.setManual({ lat: p.lat, lng: p.lng }, p.label)}
          onOpenFilters={() => setFiltersOpen(true)}
          filterCount={filterCount}
        />
      )}
      {!(listView && !isMobile) && (
        <CategoryChips
          counts={counts}
          total={all.length}
          availableCount={availableCount}
          category={category}
          onCategory={setCategory}
          availableOnly={availableOnly}
          onAvailableOnly={setAvailableOnly}
        />
      )}
      <LocationBanner />
    </header>
  );

  const sortSelect = (label: string) => (
    <label className={styles.sort}>
      {label}
      <select value={sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value as DiscoveryFilters["sort"] })} aria-label="Sort">
        <option value="nearest" disabled={!point}>
          Nearest
        </option>
        <option value="recent">Recently listed</option>
        <option value="rating">Best-rated lenders</option>
      </select>
    </label>
  );

  const renderResults = (layout: "column" | "grid") =>
    result === undefined ? (
      <LoadingState rows={4} />
    ) : items.length === 0 ? (
      <EmptyState
        compact
        icon={<Compass />}
        title={search ? "No tools match your search" : radius ? `No tools within ${radius} km of you` : "No tools found"}
        description={
          result.suggestion
            ? `The closest listings are around ${result.suggestion.label}${point ? ` (${formatDistance(haversineKm(point, result.suggestion))} away)` : ""}.`
            : "Try removing some filters, or list a tool yourself."
        }
        action={
          <>
            {radius !== undefined && (
              <Button size="sm" onClick={() => setFilters({ ...filters, radiusKm: "ANY" })}>
                Show all distances
              </Button>
            )}
            {result.suggestion && (
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  location.setManual(
                    {
                      lat: result.suggestion!.lat,
                      lng: result.suggestion!.lng,
                    },
                    result.suggestion!.label,
                  )
                }
              >
                Show tools around {result.suggestion.label.split(",")[0]}
              </Button>
            )}
          </>
        }
      />
    ) : (
      <div className={layout === "grid" ? styles.cardsGrid : styles.cards} role="list" aria-label="Tools">
        {items.map((item) => (
          <div role="listitem" key={item.id}>
            <ToolCard
              ref={(el) => {
                if (el) cardRefs.current.set(item.id, el);
                else cardRefs.current.delete(item.id);
              }}
              item={item}
              selected={item.id === selectedId}
              hovered={item.id === hoveredId}
              onSelect={(id) => selectTool(id)}
              onHover={setHoveredId}
            />
          </div>
        ))}
        {result.truncated && <p className={styles.more}>Showing the first {items.length}. Narrow the search to see more.</p>}
        <Link href="/listings/new" className={styles.lendCta}>
          <span className="display">Have a tool gathering dust?</span>
          <span>List it in two minutes — you approve every request.</span>
        </Link>
      </div>
    );

  const list = (
    <div className={styles.listWrap}>
      {showCategoryIndex && !availableOnly && result !== undefined && (
        <CategoryGrid
          items={visible}
          onPick={(c) => {
            setCategory(c);
            listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}
      <div className={styles.sectionHead}>
        {category !== "ALL" ? (
          <button type="button" className={styles.backLink} onClick={() => setCategory("ALL")}>
            <ArrowLeft aria-hidden /> All categories
          </button>
        ) : (
          <span className={styles.eyebrow}>
            {showCategoryIndex ? "All tools · " : ""}
            <span className="num">{items.length}</span> {items.length === 1 ? "tool" : "tools"}
          </span>
        )}
        {sortSelect("Sort:")}
      </div>
      {renderResults("column")}
    </div>
  );

  // List view (desktop): cards grid in the main area, filters inline in the sidebar.
  const grid = (
    <div className={styles.gridSurface}>
      <div className={styles.gridHead}>
        <div className={styles.gridTitle}>
          <h2 className="display">
            <span className="num">{items.length}</span> {items.length === 1 ? "tool" : "tools"}
            {category !== "ALL" && <span className={styles.gridTitleSub}> in {CATEGORY_LABELS[category]}</span>}
          </h2>
          {category !== "ALL" && (
            <button type="button" className={styles.backLink} onClick={() => setCategory("ALL")}>
              <ArrowLeft aria-hidden /> All categories
            </button>
          )}
        </div>
        {sortSelect("Sort by")}
      </div>
      {renderResults("grid")}
    </div>
  );

  const inlineFilters = (
    <div className={styles.inlineFilters}>
      <FiltersPanel value={filters} onChange={setFilters} hasLocation={!!point} counts={counts} total={all.length} availableCount={availableCount} />
    </div>
  );

  const floatingControls = !isMobile && !panelOpen && (
    <div className={styles.floatingControls}>
      <button type="button" className={styles.showPanel} onClick={() => setPanelOpen(true)}>
        <PanelLeftOpen aria-hidden /> {listView ? "Filters" : plural(result?.total ?? 0, "tool")}
      </button>
      <ViewToggle value={view} onChange={setView} />
    </div>
  );

  const detailView = selectedId ? (
    <ToolDetailPanel toolId={selectedId as Id<"tools">} from={point} onClose={() => selectTool(null)} onRequest={() => setRequestOpen(true)} />
  ) : null;

  const sheetHeight = snap === "half" ? viewportHeight * 0.48 : snap === "peek" ? SHEET_PEEK : viewportHeight;
  const bottomInset = isMobile ? sheetHeight + 86 : 96;

  return (
    <div
      className={clsx(styles.explore, !panelOpen && styles.panelClosed)}
      style={{
        ["--map-bottom-inset" as string]: `${isMobile ? Math.round(sheetHeight + 86) : 0}px`,
      }}
    >
      {!isMobile && (
        <aside className={styles.panel} aria-label="Nearby tools">
          {selectedId ? (
            detailView
          ) : (
            <div ref={listRef} className={styles.panelScroll}>
              {head}
              {listView ? inlineFilters : list}
            </div>
          )}
        </aside>
      )}

      {listView && !isMobile ? (
        <section className={styles.listArea} aria-label="Tools">
          {floatingControls}
          {grid}
        </section>
      ) : isMobile && listView ? (
        <section className={styles.mobileList} aria-label="Tools">
          <div className={styles.mobileListHeader}>
            <Logo compact href="/explore" />
            <div className={styles.mobileSearch}>
              <ExploreSearch
                compact
                value={query}
                onChange={setQuery}
                onPickPlace={(p) => location.setManual({ lat: p.lat, lng: p.lng }, p.label)}
                onOpenFilters={() => setFiltersOpen(true)}
                filterCount={filterCount}
              />
            </div>
            <ViewToggle compact value={view} onChange={setView} />
          </div>
          {selectedId ? (
            detailView
          ) : (
            <div className={styles.mobileListBody}>
              {head}
              {list}
            </div>
          )}
        </section>
      ) : (
        <section className={styles.mapArea} aria-label="Map">
          {isMobile && (
            <div className={styles.mobileHeader}>
              <Logo compact href="/explore" />
              <div className={styles.mobileSearch}>
                <ExploreSearch
                  compact
                  value={query}
                  onChange={setQuery}
                  onPickPlace={(p) => location.setManual({ lat: p.lat, lng: p.lng }, p.label)}
                  onOpenFilters={() => setFiltersOpen(true)}
                  filterCount={filterCount}
                />
              </div>
              <ViewToggle compact value={view} onChange={setView} />
            </div>
          )}
          <ExploreMap
            tools={items}
            selectedId={selectedId}
            hoveredId={hoveredId}
            onSelect={(id) => selectTool(id)}
            onHover={setHoveredId}
            me={
              location.state.status === "ready"
                ? {
                    point: location.state.point,
                    source: location.state.source,
                    accuracy: location.state.accuracy,
                    label: location.state.label,
                  }
                : null
            }
            radiusKm={radius ?? null}
            onLocate={locate}
            locating={location.state.status === "locating"}
            recenterKey={recenterTick}
            bottomInset={bottomInset}
            overlay={
              (!isMobile || snap !== "full") && <MapCarousel items={items} selectedId={selectedId} onSelect={(id) => selectTool(id)} onHover={setHoveredId} />
            }
          />
          <LocationPrompt />
          {floatingControls}
          {isMobile && (
            <BottomSheet
              snap={snap}
              onSnapChange={setSnap}
              peekHeight={SHEET_PEEK}
              header={
                selectedId ? null : (
                  <div className={styles.sheetPeek}>
                    <h1 className={clsx(styles.sheetTitle, "display")}>{search ? `“${search}”` : title}</h1>
                    {city && <span className={styles.sheetCount}>{city}</span>}
                  </div>
                )
              }
            >
              {selectedId ? (
                detailView
              ) : (
                <div className={styles.sheetBody}>
                  {head}
                  {list}
                </div>
              )}
            </BottomSheet>
          )}
        </section>
      )}

      <Dialog
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        footer={
          <Button variant="primary" onClick={() => setFiltersOpen(false)}>
            Show {plural(items.length, "tool")}
          </Button>
        }
      >
        <FiltersPanel value={filters} onChange={setFilters} hasLocation={!!point} />
      </Dialog>

      {detail && requestOpen && (
        <BorrowRequestModal
          open={requestOpen}
          onClose={() => setRequestOpen(false)}
          tool={{
            id: detail.id,
            name: detail.name,
            ownerName: detail.owner.name,
            maxLoanDays: detail.maxLoanDays,
            bookedRanges: detail.bookedRanges,
          }}
        />
      )}
    </div>
  );
}
