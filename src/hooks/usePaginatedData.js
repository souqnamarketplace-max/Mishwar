import { useState, useMemo } from "react";

/**
 * Client-side pagination over an in-memory array.
 * For server-side pagination, use Supabase .range() instead.
 *
 * @example
 * const { paged, page, setPage, totalPages } = usePaginatedData(allItems, 20);
 */
export function usePaginatedData(items = [], pageSize = 20) {
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const paged = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  return { paged, page: safePage, setPage, totalPages, totalItems: items.length };
}
