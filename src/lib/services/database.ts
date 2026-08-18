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