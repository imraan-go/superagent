"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CaretDown, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { Modal } from "@/components/ui";
import { connectedSlugs, prettyCategory } from "@/lib/apps";
import { cn } from "@/lib/cn";
import { LogoStack } from "./app-logo";
import { AppsProvider, useApps } from "./apps-context";
import { AppsBrowse, useSections } from "./apps-browse";
import { AppsDetail } from "./apps-detail";
import { AppsManage } from "./apps-manage";
import { KeyForm } from "./key-form";
import styles from "./apps.module.css";

export type AppsView = { kind: "browse" } | { kind: "manage" } | { kind: "detail"; slug: string; from: "browse" | "manage" };

export interface AppsRequest {
  app?: string | undefined;
  view?: "browse" | "manage" | undefined;
  /** Bumps on every open request so re-opening to the same target still applies. */
  nonce: number;
}

const CHIPS_SHOWN = 7;

function setUrlApp(slug: string | null): void {
  try {
    const url = new URL(window.location.href);
    if (slug) url.searchParams.set("app", slug);
    else url.searchParams.delete("app");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Deep-link sync is a convenience only.
  }
}

/**
 * Connect Apps: the Composio catalog as "Apps". Browse (recommended + categories,
 * full-catalog search, virtualised), App detail (tools, triggers, information,
 * deep-linkable with ?app=<slug>) and Manage (installed apps). All connecting,
 * approval and rate-limit behaviour is the existing Composio route set.
 */
export function AppsModal({ open, onClose, request }: { open: boolean; onClose: () => void; request: AppsRequest | null }) {
  const [view, setView] = useState<AppsView>({ kind: "browse" });
  const [seen, setSeen] = useState<number | null>(null);

  // Apply an open request on the closed -> open (or re-request) transition.
  if (open && request && request.nonce !== seen) {
    setSeen(request.nonce);
    setView(request.app ? { kind: "detail", slug: request.app, from: "browse" } : request.view === "manage" ? { kind: "manage" } : { kind: "browse" });
  }

  const openApp = useCallback((slug: string) => {
    setView((v) => ({ kind: "detail", slug, from: v.kind === "manage" ? "manage" : "browse" }));
  }, []);

  useEffect(() => {
    if (!open) return;
    setUrlApp(view.kind === "detail" ? view.slug : null);
  }, [open, view]);

  const close = useCallback(() => {
    setUrlApp(null);
    onClose();
  }, [onClose]);

  return (
    <AppsProvider openApp={openApp}>
      <AppsDialog open={open} view={view} setView={setView} onClose={close} />
    </AppsProvider>
  );
}

function AppsDialog({ open, view, setView, onClose }: { open: boolean; view: AppsView; setView: (v: AppsView) => void; onClose: () => void }) {
  const apps = useApps();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [flat, setFlat] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const setScroll = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    setScrollEl(el);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 220);
    return () => clearTimeout(t);
  }, [search]);

  const configured = apps.status?.configured === true;
  const connected = apps.status?.configured ? connectedSlugs(apps.status) : [];
  const sections = useSections(open && configured);
  const facets = sections.data?.facets ?? [];
  const chips = facets.slice(0, CHIPS_SHOWN);
  const more = facets.slice(CHIPS_SHOWN);
  const activeInMore = more.some((f) => f.name === category);

  const pickCategory = (c: string) => {
    setCategory(c);
    setFlat(false);
    setMoreOpen(false);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const handleClose = () => {
    if (moreOpen) setMoreOpen(false);
    else onClose();
  };

  const back = () => setView(view.kind === "detail" && view.from === "manage" ? { kind: "manage" } : { kind: "browse" });
  const title =
    view.kind === "detail" ? "App details" : view.kind === "manage" ? "Manage apps" : "Connect apps";

  return (
    <Modal
      open={open}
      onClose={handleClose}
      wide
      bodyFlush
      className={styles.dialog}
      title={
        <span className={styles.titleRow}>
          {view.kind !== "browse" && (
            <button type="button" className={styles.backBtn} onClick={back} aria-label="Back">
              <ArrowLeft size={16} weight="bold" aria-hidden />
            </button>
          )}
          {title}
        </span>
      }
    >
      {open && (
      <div className={styles.shell}>
        {!configured ? (
          apps.statusLoading ? (
            <div className={styles.pad} aria-busy>
              <p className={styles.muted}>Loading…</p>
            </div>
          ) : (
            <KeyForm />
          )
        ) : (
          <>
            {view.kind === "browse" && (
              <div className={styles.toolbar}>
                <div className={styles.topRow}>
                  <label className={styles.search}>
                    <MagnifyingGlass size={16} aria-hidden />
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        if (e.target.value) setFlat(false);
                      }}
                      placeholder="Search across apps and tools"
                      aria-label="Search across all apps"
                      autoComplete="off"
                    />
                  </label>
                  <button type="button" className={styles.installedBtn} onClick={() => setView({ kind: "manage" })} aria-label={`${connected.length} connected. Manage apps`}>
                    <LogoStack slugs={connected} max={3} size={20} />
                    <span>
                      <span className={styles.num}>{connected.length}</span> connected
                    </span>
                  </button>
                </div>
                <div className={styles.chipRow}>
                  <div className={styles.chips} role="group" aria-label="Categories">
                    <button type="button" className={cn(styles.chip, !category && !flat && styles.chipOn)} aria-pressed={!category && !flat} onClick={() => { pickCategory(""); }}>
                      All
                    </button>
                    {chips.map((f) => (
                      <button key={f.name} type="button" className={cn(styles.chip, category === f.name && styles.chipOn)} aria-pressed={category === f.name} onClick={() => pickCategory(f.name)}>
                        {prettyCategory(f.name)}
                      </button>
                    ))}
                    {activeInMore && (
                      <button type="button" className={cn(styles.chip, styles.chipOn)} aria-pressed onClick={() => pickCategory(category)}>
                        {prettyCategory(category)}
                      </button>
                    )}
                  </div>
                  {more.length > 0 && (
                    <div className={styles.moreWrap}>
                      <button type="button" className={styles.chip} aria-haspopup="listbox" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
                        More <CaretDown size={11} weight="bold" aria-hidden />
                      </button>
                      {moreOpen && (
                        <ul className={styles.morePop} role="listbox" aria-label="More categories">
                          {more.map((f) => (
                            <li key={f.name} role="option" aria-selected={category === f.name}>
                              <button type="button" onClick={() => pickCategory(f.name)}>
                                {prettyCategory(f.name)} <span className={styles.num}>{f.count}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {apps.note && view.kind !== "detail" && (
              <p className={styles.note} role="status">
                {apps.note.text}{" "}
                {apps.note.href && (
                  <a href={apps.note.href} target="_blank" rel="noopener noreferrer" className={styles.link}>
                    {apps.note.hrefLabel ?? "Open"}
                  </a>
                )}
              </p>
            )}
            {apps.status?.configured && apps.status.error && <p className={styles.err}>{apps.status.error}</p>}

            <div className={styles.scroll} ref={setScroll}>
              {view.kind === "browse" && (
                <AppsBrowse
                  scrollEl={scrollEl}
                  q={q}
                  category={category}
                  flat={flat}
                  onCategory={pickCategory}
                  onBrowseAll={() => {
                    setFlat(true);
                    setCategory("");
                    scrollRef.current?.scrollTo({ top: 0 });
                  }}
                />
              )}
              {view.kind === "detail" && <AppsDetail key={view.slug} slug={view.slug} />}
              {view.kind === "manage" && <AppsManage onClose={onClose} />}
            </div>
          </>
        )}
      </div>
      )}
    </Modal>
  );
}
