import { describe, expect, it, vi, beforeEach } from 'vitest';

const { processChunkMock, updateUploadStatusMock } = vi.hoisted(() => ({
  processChunkMock: vi.fn(),
  updateUploadStatusMock: vi.fn().mockResolvedValue({ data: null, error: null }),
}));

vi.mock('./services/import.service', () => ({
  ImportService: {
    processChunk: processChunkMock,
  },
}));

vi.mock('./services/upload.service', () => ({
  UploadService: {
    updateUploadStatus: updateUploadStatusMock,
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
    }),
  },
}));

import { ChunkProcessor } from './chunk-processor';

describe('ChunkProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not double-count row validation errors when a chunk fails', async () => {
    processChunkMock.mockResolvedValue({
      success: true,
      rowsProcessed: 0,
      errors: [
        { row_number: 1, error_type: 'missing_boid', error_message: 'BOID is empty' },
        { row_number: 2, error_type: 'missing_boid', error_message: 'BOID is empty' },
      ],
    });

    const result = await ChunkProcessor.processInChunks(
      'upload-123',
      [{ boid: '' }, { boid: '' }],
      'dividend_payables',
      1000,
      undefined,
      { fileHash: 'abc123' }
    );

    expect(result.errorRows).toBe(2);
    expect(result.successRows).toBe(0);
    expect(processChunkMock).toHaveBeenCalledTimes(1);
  });
});
