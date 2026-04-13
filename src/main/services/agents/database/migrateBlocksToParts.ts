/**
 * Migration: Convert Agent session messages from blocks[] to parts[] format.
 *
 * Old format (AgentPersistedMessage):
 *   { message: { blocks: string[], ... }, blocks: MessageBlock[] }
 *
 * New format:
 *   { message: { data: { parts: CherryMessagePart[] }, blocks: [], ... }, blocks: [] }
 *
 * The conversion is derived from the renderer's blocksToParts.ts but runs in Main
 * without renderer dependencies. After migration, blocks arrays are emptied (not deleted)
 * so old code paths won't crash during the transition.
 */

import { loggerService } from '@logger'
import { asc, eq } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

import type * as schema from './schema'
import { sessionMessagesTable } from './schema'

const logger = loggerService.withContext('MigrateBlocksToParts')

export interface BlocksToPartsMigrationResult {
  totalMessages: number
  messagesConverted: number
  messagesSkipped: number
  errors: Array<{ rowId: number; error: string }>
}

// ── Block type constants (mirror of renderer's MessageBlockType) ──

const BLOCK_TYPE = {
  MAIN_TEXT: 'main_text',
  THINKING: 'thinking',
  IMAGE: 'image',
  FILE: 'file',
  TOOL: 'tool',
  CITATION: 'citation',
  ERROR: 'error',
  TRANSLATION: 'translation',
  VIDEO: 'video',
  COMPACT: 'compact',
  CODE: 'code'
} as const

// ── Converter ──

interface BlockLike {
  type: string
  content?: string
  url?: string
  file?: { path?: string; name?: string }
  toolId?: string
  toolName?: string
  arguments?: unknown
  status?: string
  response?: unknown
  knowledge?: unknown
  memories?: unknown
  error?: { name?: string; message?: string; code?: string }
  targetLanguage?: string
  sourceLanguage?: string
  filePath?: string
  compactedContent?: string
  language?: string
}

function blockToPart(block: BlockLike): Record<string, unknown> | null {
  switch (block.type) {
    case BLOCK_TYPE.MAIN_TEXT:
      return { type: 'text', text: block.content || '' }

    case BLOCK_TYPE.THINKING:
      return { type: 'reasoning', text: block.content || '', reasoning: block.content || '' }

    case BLOCK_TYPE.IMAGE:
      return { type: 'file', mediaType: 'image/png', url: block.url || '' }

    case BLOCK_TYPE.FILE:
      return {
        type: 'file',
        mediaType: 'application/octet-stream',
        url: block.file?.path ? `file://${block.file.path}` : '',
        filename: block.file?.name || ''
      }

    case BLOCK_TYPE.TOOL: {
      const toolName = block.toolName ?? 'unknown'
      return {
        type: `tool-${toolName}`,
        toolCallId: block.toolId,
        toolName,
        state: block.status === 'error' ? 'output-error' : 'output-available',
        input: block.arguments,
        output: block.content
      }
    }

    case BLOCK_TYPE.CITATION:
      return {
        type: 'data-citation',
        data: { response: block.response, knowledge: block.knowledge, memories: block.memories }
      }

    case BLOCK_TYPE.ERROR:
      return {
        type: 'data-error',
        data: { name: block.error?.name, message: block.error?.message, code: block.error?.code }
      }

    case BLOCK_TYPE.TRANSLATION:
      return {
        type: 'data-translation',
        data: {
          content: block.content || '',
          targetLanguage: block.targetLanguage || '',
          sourceLanguage: block.sourceLanguage
        }
      }

    case BLOCK_TYPE.VIDEO:
      return { type: 'data-video', data: { url: block.url, filePath: block.filePath } }

    case BLOCK_TYPE.COMPACT:
      return {
        type: 'data-compact',
        data: { content: block.content || '', compactedContent: block.compactedContent || '' }
      }

    case BLOCK_TYPE.CODE:
      return { type: 'data-code', data: { content: block.content || '', language: block.language || '' } }

    default:
      logger.warn('Unknown block type during migration', { type: block.type })
      return null
  }
}

// ── Migration runner ──

export async function runBlocksToPartsMigration(
  database: LibSQLDatabase<typeof schema>
): Promise<BlocksToPartsMigrationResult> {
  const result: BlocksToPartsMigrationResult = {
    totalMessages: 0,
    messagesConverted: 0,
    messagesSkipped: 0,
    errors: []
  }

  const rows = await database.select().from(sessionMessagesTable).orderBy(asc(sessionMessagesTable.created_at))
  result.totalMessages = rows.length
  logger.info(`Blocks→Parts migration: processing ${rows.length} messages`)

  for (const row of rows) {
    if (!row?.content) continue

    try {
      const parsed = JSON.parse(row.content)
      const blocks: BlockLike[] = parsed?.blocks ?? []
      const message = parsed?.message

      if (!message) continue

      // Already migrated: has data.parts and no blocks
      if (message.data?.parts?.length > 0 && blocks.length === 0) {
        result.messagesSkipped++
        continue
      }

      // Nothing to convert
      if (blocks.length === 0) {
        result.messagesSkipped++
        continue
      }

      // Convert blocks → parts
      const parts = blocks.map(blockToPart).filter(Boolean)

      // Update message: set data.parts, clear blocks references
      message.data = { ...(message.data ?? {}), parts }
      message.blocks = []
      parsed.blocks = []

      await database
        .update(sessionMessagesTable)
        .set({ content: JSON.stringify(parsed), updated_at: new Date().toISOString() })
        .where(eq(sessionMessagesTable.id, row.id))

      result.messagesConverted++
    } catch (error) {
      result.errors.push({ rowId: row.id, error: error instanceof Error ? error.message : String(error) })
      logger.warn(`Failed to migrate message ${row.id}`, { error })
    }
  }

  logger.info(
    `Blocks→Parts migration complete: ${result.messagesConverted} converted, ${result.messagesSkipped} skipped, ${result.errors.length} errors`
  )
  return result
}
