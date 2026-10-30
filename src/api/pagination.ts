import type { PageDto } from "../types/entities.js";

/** Reads every page of a Spring-style paged endpoint (`page` is 0-based). */
export async function fetchAllPages<T>(
  fetchPage: (page: number, size: number) => Promise<PageDto<T>>,
  size = 100,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 0; ; page += 1) {
    const result = await fetchPage(page, size);
    const content = result.content ?? [];
    items.push(...content);
    const totalPages = result.totalPages ?? 0;
    if (content.length === 0 || page + 1 >= totalPages) return items;
  }
}
