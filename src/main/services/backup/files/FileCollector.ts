import type { Client } from '@libsql/client'
import { loggerService } from '@logger'

import type { CancellationToken } from '../CancellationToken'

const logger = loggerService.withContext('FileCollector')
const BATCH_SIZE = 1000

export async function collectReferencedFiles(client: Client, token: CancellationToken): Promise<Set<string>> {
  const fileIds = new Set<string>()
  let offset = 0
  while (true) {
    token.throwIfCancelled()
    const result = await client.execute({
      sql: 'SELECT data FROM message WHERE data IS NOT NULL LIMIT ? OFFSET ?',
      args: [BATCH_SIZE, offset]
    })
    if (result.rows.length === 0) break
    for (const row of result.rows) {
      try {
        const data = JSON.parse(row.data as string)
        for (const block of data.blocks ?? []) {
          const id = extractFileId(block)
          if (id) fileIds.add(id)
        }
      } catch {
        logger.warn('Skipping unparseable message data', { offset })
      }
    }
    offset += BATCH_SIZE
  }
  logger.info('File collection complete', { fileCount: fileIds.size })
  return fileIds
}

export function extractFileId(block: Record<string, unknown>): string | null {
  if (block.type === 'file') {
    return (block.fileId as string) ?? null
  }
  if (block.type === 'image') {
    return (block.fileId as string) ?? null
  }
  return null
}
