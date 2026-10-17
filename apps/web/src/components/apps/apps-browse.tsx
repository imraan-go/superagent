'use client';

import { useCallback, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/components/settings/tabs/shared';
import { Button, SkeletonText } from '@/components/ui';
import { prettyCategory } from '@/lib/apps';
import { COMPOSIO_STATUS_KEY } from '@/lib/composio-types';
import type { CatalogPage, CatalogSectionsResponse, CatalogToolkit } from '@/lib/composio-types';
import { AppRow, RowSkeleton } from './app-row';
import { VirtualGrid, gridKeyNav } from './virtual-grid';
import styles from './apps.module.css';

const PAGE = 100;
const SECTION_STEP = 10;

export const CATALOG_KEY = [...COMPOSIO_STATUS_KEY, 'catalog'] as const;

export function useSections(enabled: boolean) {
  return useQuery({
    queryKey: [...CATALOG_KEY, 'sections'],
    queryFn: () => api<CatalogSectionsResponse>('/api/connectors/composio/catalog?view=sections'),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** Search + category facet over the FULL catalog, server-paged 100 at a time. */
export function useFlatCatalog(q: string, category: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [...CATALOG_KEY, 'flat', q, category],
    enabled,
    staleTime: 5 * 60_000,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<CatalogPage>(
        `/api/connectors/composio/catalog?${new URLSearchParams({ q, category, offset: String(pageParam), limit: String(PAGE) })}`,
      ),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total && last.items.length > 0 ? loaded : undefined;
    },
  });
}

export function AppsBrowse({
  scrollEl,
  q,
  category,
  flat,
  onCategory,
  onBrowseAll,
}: {
  scrollEl: HTMLElement | null;
  q: string;
  category: string;
  flat: boolean;
  onCategory: (c: string) => void;
  onBrowseAll: () => void;
}) {
  const sectioned = !q && !category && !flat;
  return sectioned ? (
    <Sections onCategory={onCategory} onBrowseAll={onBrowseAll} />
  ) : (
    <Flat scrollEl={scrollEl} q={q} category={category} />
  );
}

function Sections({ onCategory, onBrowseAll }: { onCategory: (c: string) => void; onBrowseAll: () => void }) {
  const { data, isPending, error, refetch } = useSections(true);
  const [shown, setShown] = useState(SECTION_STEP);
  if (isPending) {
    return (
      <div className={styles.pad} aria-busy>
        <SkeletonText lines={3} />
        <SkeletonText lines={6} />
      </div>
    );
  }
  if (error) {
    return (
      <div className={styles.pad} role="alert">
        <p className={styles.err}>{error.message}</p>
        <Button size="sm" variant="outline" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  const total = data.upstreamTotal ?? data.catalogSize;
  return (
    <div className={styles.sections} onKeyDown={gridKeyNav}>
      {data.recommended.length > 0 && (
        <section className={styles.section} aria-labelledby="apps-rec">
          <h3 id="apps-rec" className={styles.sectionHead}>
            Recommended for you
          </h3>
          <Grid items={data.recommended} />
        </section>
      )}
      {data.sections.slice(0, shown).map((s) => (
        <section key={s.category} className={styles.section} aria-label={prettyCategory(s.category)}>
          <div className={styles.sectionBar}>
            <h3 className={styles.sectionHead}>{prettyCategory(s.category)}</h3>
            <button type="button" className={styles.viewAll} onClick={() => onCategory(s.category)}>
              View all <span className={styles.num}>{s.count}</span>
            </button>
          </div>
          <Grid items={s.items} />
        </section>
      ))}
      <div className={styles.sectionsFoot}>
        {shown < data.sections.length && (
          <Button size="sm" variant="ghost" onClick={() => setShown(shown + SECTION_STEP)}>
            Show more categories ({data.sections.length - shown} left)
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onBrowseAll}>
          Browse all <span className={styles.num}>{total}</span> apps
        </Button>
      </div>
    </div>
  );
}

function Grid({ items }: { items: CatalogToolkit[] }) {
  return (
    <div className={styles.grid} role="list">
      {items.map((t) => (
        <div key={t.slug} role="listitem" className={styles.gridCell}>
          <AppRow app={t} />
        </div>
      ))}
    </div>
  );
}

function Flat({ scrollEl, q, category }: { scrollEl: HTMLElement | null; q: string; category: string }) {
  const query = useFlatCatalog(q, category, true);
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  const onRange = useCallback(
    (last: number) => {
      // Fetch ahead; a far scrollbar jump just keeps fetching pages until the window is covered.
      if (hasNextPage && !isFetchingNextPage && last >= items.length - 24) void fetchNextPage();
    },
    [hasNextPage, isFetchingNextPage, items.length, fetchNextPage],
  );

  if (query.isPending) {
    return (
      <div className={styles.pad} aria-busy>
        <SkeletonText lines={6} />
      </div>
    );
  }
  if (query.error) {
    return (
      <div className={styles.pad} role="alert">
        <p className={styles.err}>{query.error.message}</p>
        <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div className={styles.flat} onKeyDown={gridKeyNav}>
      <p className={styles.flatMeta} role="status">
        <span className={styles.num}>{total}</span> {total === 1 ? 'app' : 'apps'}
        {category ? ` in ${prettyCategory(category)}` : ''}
        {q ? ` matching “${q}”` : ''}
      </p>
      {total === 0 ? (
        <p className={styles.empty}>No apps match. Try a shorter name, or clear the category.</p>
      ) : (
        <VirtualGrid
          scrollEl={scrollEl}
          total={total}
          onRange={onRange}
          getItem={(i) => {
            const t = items[i];
            return t ? <AppRow app={t} className={styles.vrow} /> : undefined;
          }}
          skeleton={() => <RowSkeleton />}
        />
      )}
    </div>
  );
}
