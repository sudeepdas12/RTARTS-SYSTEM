import { describe, expect, it, vi } from 'vitest';
import { chunkArray } from './bulk-ops';
import { RECONCILIATION_TOLERANCE_NPR, BULK_CHUNK_SIZE } from './constants';

describe('bulk operations & constants', () => {
  it('chunks arrays accurately', () => {
    const items = Array.from({ length: 550 }, (_, i) => i);
    const chunks = chunkArray(items, 200);

    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(200);
    expect(chunks[1].length).toBe(200);
    expect(chunks[2].length).toBe(150);
  });

  it('handles empty or small arrays safely', () => {
    expect(chunkArray([])).toEqual([]);
    expect(chunkArray([1, 2, 3], 100)).toEqual([[1, 2, 3]]);
  });

  it('exports system-wide reconciliation tolerance', () => {
    expect(RECONCILIATION_TOLERANCE_NPR).toBe(0.50);
    expect(BULK_CHUNK_SIZE).toBe(200);
  });
});
