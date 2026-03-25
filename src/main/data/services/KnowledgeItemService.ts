/**
 * Knowledge Item Service (DataApi v2).
 *
 * Handles CRUD operations for knowledge items stored in SQLite.
 */

import type OpenAI from '@cherrystudio/openai'
import { dbService } from '@data/db/DbService'
import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateKnowledgeItemsDto, UpdateKnowledgeItemDto } from '@shared/data/api/schemas/knowledges'
import { type FileMetadata, FileTypeSchema } from '@shared/data/types/file'
import type { KnowledgeItem, KnowledgeItemDataMap } from '@shared/data/types/knowledge'
import { and, desc, eq, isNull } from 'drizzle-orm'
import * as z from 'zod'

import { knowledgeBaseService } from './KnowledgeBaseService'

const logger = loggerService.withContext('DataApi:KnowledgeItemService')

const fileMetadataSchema: z.ZodType<FileMetadata> = z.object({
  id: z.string(),
  name: z.string(),
  origin_name: z.string(),
  path: z.string(),
  size: z.number(),
  ext: z.string(),
  type: FileTypeSchema,
  created_at: z.string(),
  count: z.number(),
  tokens: z.number().optional(),
  purpose: z.custom<OpenAI.FilePurpose>((value) => typeof value === 'string').optional()
})

const fileItemDataSchema: z.ZodType<KnowledgeItemDataMap['file']> = z.object({
  file: fileMetadataSchema
})

const urlItemDataSchema: z.ZodType<KnowledgeItemDataMap['url']> = z.object({
  url: z.string(),
  name: z.string()
})

const noteItemDataSchema: z.ZodType<KnowledgeItemDataMap['note']> = z.object({
  content: z.string(),
  sourceUrl: z.string().optional()
})

const sitemapItemDataSchema: z.ZodType<KnowledgeItemDataMap['sitemap']> = z.object({
  url: z.string(),
  name: z.string()
})

const directoryContainerSchema = z.object({
  kind: z.literal('container'),
  path: z.string(),
  recursive: z.boolean()
}) satisfies z.ZodType<Extract<KnowledgeItemDataMap['directory'], { kind: 'container' }>>

const directoryFileEntrySchema = z.object({
  kind: z.literal('entry'),
  groupId: z.string(),
  groupName: z.string(),
  file: fileMetadataSchema
}) satisfies z.ZodType<Extract<KnowledgeItemDataMap['directory'], { kind: 'entry' }>>

const directoryDataSchema = z.discriminatedUnion('kind', [
  directoryContainerSchema,
  directoryFileEntrySchema
]) satisfies z.ZodType<KnowledgeItemDataMap['directory']>

type DirectoryEntryData = Extract<KnowledgeItemDataMap['directory'], { kind: 'entry' }>
type CreateDirectoryEntryInput = Omit<DirectoryEntryData, 'kind'>

function parseKnowledgeItemData<T extends keyof KnowledgeItemDataMap>(
  type: T,
  value: unknown,
  itemId: string
): KnowledgeItemDataMap[T] {
  switch (type) {
    case 'file': {
      const result = fileItemDataSchema.safeParse(value)
      if (result.success) return result.data as KnowledgeItemDataMap[T]
      throw new Error(`Invalid knowledge item data for type=file (id=${itemId}): ${result.error.message}`)
    }
    case 'url': {
      const result = urlItemDataSchema.safeParse(value)
      if (result.success) return result.data as KnowledgeItemDataMap[T]
      throw new Error(`Invalid knowledge item data for type=url (id=${itemId}): ${result.error.message}`)
    }
    case 'note': {
      const result = noteItemDataSchema.safeParse(value)
      if (result.success) return result.data as KnowledgeItemDataMap[T]
      throw new Error(`Invalid knowledge item data for type=note (id=${itemId}): ${result.error.message}`)
    }
    case 'sitemap': {
      const result = sitemapItemDataSchema.safeParse(value)
      if (result.success) return result.data as KnowledgeItemDataMap[T]
      throw new Error(`Invalid knowledge item data for type=sitemap (id=${itemId}): ${result.error.message}`)
    }
    case 'directory': {
      const result = directoryDataSchema.safeParse(value)
      if (result.success) return result.data as KnowledgeItemDataMap[T]
      throw new Error(`Invalid knowledge item data for type=directory (id=${itemId}): ${result.error.message}`)
    }
    default: {
      const neverType: never = type
      throw new Error(`Unsupported knowledge item type: ${String(neverType)}`)
    }
  }
}

function validateKnowledgeItemData<T extends keyof KnowledgeItemDataMap>(
  type: T,
  value: unknown,
  fieldPath: string,
  itemId: string
): KnowledgeItemDataMap[T] {
  try {
    return parseKnowledgeItemData(type, value, itemId) as KnowledgeItemDataMap[T]
  } catch (error) {
    throw DataApiErrorFactory.validation({
      [fieldPath]: [error instanceof Error ? error.message : String(error)]
    })
  }
}

function validateDirectoryEntryData(value: unknown, fieldPath: string): DirectoryEntryData {
  const result = directoryFileEntrySchema.safeParse(value)
  if (result.success) {
    return result.data
  }

  throw DataApiErrorFactory.validation({
    [fieldPath]: [result.error.message]
  })
}

function rowToKnowledgeItem(row: typeof knowledgeItemTable.$inferSelect): KnowledgeItem {
  const base = {
    id: row.id,
    baseId: row.baseId,
    parentId: row.parentId ?? null,
    status: row.status ?? 'idle',
    error: row.error ?? undefined,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  }

  switch (row.type) {
    case 'file':
      const fileData = parseKnowledgeItemData('file', row.data, row.id)
      return { ...base, type: 'file', data: fileData }
    case 'url':
      const urlData = parseKnowledgeItemData('url', row.data, row.id)
      return { ...base, type: 'url', data: urlData }
    case 'note':
      const noteData = parseKnowledgeItemData('note', row.data, row.id)
      return { ...base, type: 'note', data: noteData }
    case 'sitemap':
      const sitemapData = parseKnowledgeItemData('sitemap', row.data, row.id)
      return { ...base, type: 'sitemap', data: sitemapData }
    case 'directory':
      const directoryData = parseKnowledgeItemData('directory', row.data, row.id)
      return { ...base, type: 'directory', data: directoryData }
    default: {
      const neverType: never = row.type
      throw new Error(`Unsupported knowledge item type: ${String(neverType)}`)
    }
  }
}

export class KnowledgeItemService {
  private static instance: KnowledgeItemService

  private constructor() {}

  public static getInstance(): KnowledgeItemService {
    if (!KnowledgeItemService.instance) {
      KnowledgeItemService.instance = new KnowledgeItemService()
    }
    return KnowledgeItemService.instance
  }

  async list(baseId: string, parentId?: string): Promise<KnowledgeItem[]> {
    const db = dbService.getDb()
    await knowledgeBaseService.getById(baseId)

    const rows = await db
      .select()
      .from(knowledgeItemTable)
      .where(
        parentId
          ? and(eq(knowledgeItemTable.baseId, baseId), eq(knowledgeItemTable.parentId, parentId))
          : and(eq(knowledgeItemTable.baseId, baseId), isNull(knowledgeItemTable.parentId))
      )
      .orderBy(desc(knowledgeItemTable.createdAt))

    return rows.map((row) => rowToKnowledgeItem(row))
  }

  async create(baseId: string, dto: CreateKnowledgeItemsDto): Promise<{ items: KnowledgeItem[] }> {
    const db = dbService.getDb()
    await knowledgeBaseService.getById(baseId)

    if (!dto.items || dto.items.length === 0) {
      throw DataApiErrorFactory.validation({ items: ['At least one item is required'] })
    }
    for (const [index, item] of dto.items.entries()) {
      if (item.data === undefined || item.data === null) {
        throw DataApiErrorFactory.validation({
          [`items.${index}.data`]: ['Item data is required']
        })
      }
    }

    const values: Array<typeof knowledgeItemTable.$inferInsert> = dto.items.map((item, index) => ({
      baseId,
      parentId: null,
      type: item.type,
      data: validateKnowledgeItemData(item.type, item.data, `items.${index}.data`, `new-item-${index}`),
      status: 'idle',
      error: null
    }))

    const rows = await db.insert(knowledgeItemTable).values(values).returning()
    const items = rows.map((row) => rowToKnowledgeItem(row))

    logger.info('Created knowledge items', { baseId, count: items.length })
    return { items }
  }

  async createDirectoryEntries(
    parentId: string,
    entries: CreateDirectoryEntryInput[]
  ): Promise<{ items: KnowledgeItem[] }> {
    if (entries.length === 0) {
      throw DataApiErrorFactory.validation({ items: ['At least one item is required'] })
    }

    const parent = await this.getById(parentId)
    if (parent.type !== 'directory' || parent.data.kind !== 'container') {
      throw DataApiErrorFactory.validation({
        parentId: ['Parent must reference a directory container item']
      })
    }

    const db = dbService.getDb()
    const values: Array<typeof knowledgeItemTable.$inferInsert> = entries.map((entry, index) => ({
      baseId: parent.baseId,
      parentId,
      type: 'directory',
      data: validateDirectoryEntryData({ kind: 'entry', ...entry }, `items.${index}.data`),
      status: 'idle',
      error: null
    }))

    const rows = await db.insert(knowledgeItemTable).values(values).returning()
    const items = rows.map((row) => rowToKnowledgeItem(row))

    logger.info('Created knowledge directory entry items', {
      baseId: parent.baseId,
      parentId,
      count: items.length
    })
    return { items }
  }

  async getById(id: string): Promise<KnowledgeItem> {
    const db = dbService.getDb()
    const [row] = await db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('KnowledgeItem', id)
    }

    return rowToKnowledgeItem(row)
  }

  async update(id: string, dto: UpdateKnowledgeItemDto): Promise<KnowledgeItem> {
    const db = dbService.getDb()
    const existing = await this.getById(id)

    const updates: Partial<typeof knowledgeItemTable.$inferInsert> = {}
    if (dto.data !== undefined) {
      updates.data = validateKnowledgeItemData(existing.type, dto.data, 'data', id)
    }
    if (dto.status !== undefined) updates.status = dto.status
    if (dto.error !== undefined) updates.error = dto.error

    if (Object.keys(updates).length === 0) {
      throw DataApiErrorFactory.validation({ body: ['At least one field is required'] })
    }

    const [row] = await db.update(knowledgeItemTable).set(updates).where(eq(knowledgeItemTable.id, id)).returning()
    logger.info('Updated knowledge item', { id, changes: Object.keys(dto) })
    return rowToKnowledgeItem(row)
  }

  async delete(id: string): Promise<void> {
    const db = dbService.getDb()
    await this.getById(id)
    await db.delete(knowledgeItemTable).where(eq(knowledgeItemTable.id, id))
    logger.info('Deleted knowledge item', { id })
  }
}

export const knowledgeItemService = KnowledgeItemService.getInstance()
