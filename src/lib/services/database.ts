import { supabase } from "@/integrations/supabase/client";

export { supabase };

export type DbResult<T> = { data: T | null; error: Error | null };
export type DbResultOk<T> = { data: T; error: null };

export function handleError(error: Error | null, context: string): never {
  const message = error ? `${context}: ${error.message}` : `${context}: Unknown error`;
  throw new Error(message);
}

export function throwIfError(error: Error | null, context: string) {
  if (error) handleError(error, context);
}

/** Pagination helper */
export interface PageRequest {
  page?: number;
  pageSize?: number;
}

export interface Page<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Automatically pages through Supabase PostgREST queries (which default to 1,000 rows max)
 * to retrieve the entire dataset for full reporting and summary aggregation.
 */
export async function fetchAllRows<T>(
  queryBuilder: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = 1000,
  maxRows = 200000,
): Promise<T[]> {
  const allRows: T[] = [];
  let from = 0;
  let hasMore = false;

  while (from < maxRows) {
    const to = from + pageSize - 1;
    const { data, error } = await queryBuilder(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < pageSize) {
      hasMore = false;
      break; // Reached last page
    }
    hasMore = true;
    from += pageSize;
  }

  // Safety threshold: if the loop exited because `from >= maxRows` and the last batch was full,
  // there are additional records beyond maxRows. Silent truncation is strictly prohibited!
  if (from >= maxRows && hasMore) {
    throw new Error(
      `Query safety threshold exceeded: Dataset contains more than ${maxRows.toLocaleString()} records. ` +
        `To prevent incomplete statutory reporting, silent truncation is blocked. Please apply narrower date, company, or status filters.`,
    );
  }

  return allRows;
}

/**
 * Async generator to stream pages from Supabase with near-zero memory footprint.
 * Ideal for exporting or processing datasets with 50,000+ rows without buffer bloat.
 */
export async function* streamAllRows<T>(
  queryBuilder: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = 1000,
  maxRows = 200000,
): AsyncGenerator<T[], void, unknown> {
  let from = 0;
  let hasMore = false;

  while (from < maxRows) {
    const to = from + pageSize - 1;
    const { data, error } = await queryBuilder(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    yield data;
    if (data.length < pageSize) {
      hasMore = false;
      break;
    }
    hasMore = true;
    from += pageSize;
  }

  if (from >= maxRows && hasMore) {
    throw new Error(
      `Query safety threshold exceeded: Dataset contains more than ${maxRows.toLocaleString()} records. ` +
        `To prevent incomplete statutory reporting, silent truncation is blocked. Please apply narrower date, company, or status filters.`,
    );
  }
}
