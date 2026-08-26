import { supabase } from '@/integrations/supabase/client';
import { BULK_CHUNK_SIZE } from './constants';

/**
 * Split an array into smaller chunks
 */
export function chunkArray<T>(items: T[], chunkSize = BULK_CHUNK_SIZE): T[][] {
  if (!items || items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Perform a chunked bulk update on a table using .in('id', chunk)
 */
export async function bulkUpdateByIds(
  tableName: string,
  ids: string[],
  payload: Record<string, any>,
  chunkSize = BULK_CHUNK_SIZE
): Promise<{ updatedCount: number; errors: any[] }> {
  if (!ids || ids.length === 0) return { updatedCount: 0, errors: [] };

  const chunks = chunkArray(ids, chunkSize);
  let updatedCount = 0;
  const errors: any[] = [];

  for (const chunk of chunks) {
    const { error, count } = await (supabase as any)
      .from(tableName)
      .update(payload, { count: 'exact' })
      .in('id', chunk);

    if (error) {
      errors.push(error);
    } else {
      updatedCount += count ?? chunk.length;
    }
  }

  return { updatedCount, errors };
}

/**
 * Perform a chunked bulk delete on a table using .in('id', chunk)
 */
export async function bulkDeleteByIds(
  tableName: string,
  ids: string[],
  chunkSize = BULK_CHUNK_SIZE
): Promise<{ deletedCount: number; errors: any[] }> {
  if (!ids || ids.length === 0) return { deletedCount: 0, errors: [] };

  const chunks = chunkArray(ids, chunkSize);
  let deletedCount = 0;
  const errors: any[] = [];

  for (const chunk of chunks) {
    const { error, count } = await (supabase as any)
      .from(tableName)
      .delete({ count: 'exact' })
      .in('id', chunk);

    if (error) {
      errors.push(error);
    } else {
      deletedCount += count ?? chunk.length;
    }
  }

  return { deletedCount, errors };
}
