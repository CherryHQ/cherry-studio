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
import { type FileMetadata, FileTypes } from '@shared/data/types/file'
import type { KnowledgeItem, KnowledgeItemDataMap, KnowledgeItemTreeNode } from '@shared/data/types/knowledge'
import { desc, eq, inArray } from 'drizzle-orm'
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
  type: z.enum(FileTypes),
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

const directoryContainerSchema: z.ZodType<Extract<KnowledgeItemDataMap['directory'], { path: string }>> = z.object({
  path: z.string(),
  recursive: z.boolean()
})

const directoryFileEntrySchema: z.ZodType<Extract<KnowledgeItemDataMap['directory'], { groupId: string }>> = z.object({
  groupId: z.string(),
  groupName: z.string(),
  file: fileMetadataSchema
})

const directoryDataSchema: z.ZodType<KnowledgeItemDataMap['directory']> = z.union([
  directoryContainerSchema,
  directoryFileEntrySchema
])

const parseJsonValue = (value: unknown, itemId: string): unknown => {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'string') return value

  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(
      `Invalid JSON knowledge item data (id=${itemId}): ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function parseKnowledgeItemData(type: 'file', value: unknown, itemId: string): KnowledgeItemDataMap['file']
function parseKnowledgeItemData(type: 'url', value: unknown, itemId: string): KnowledgeItemDataMap['url']
function parseKnowledgeItemData(type: 'note', value: unknown, itemId: string): KnowledgeItemDataMap['note']
function parseKnowledgeItemData(type: 'sitemap', value: unknown, itemId: string): KnowledgeItemDataMap['sitemap']
function parseKnowledgeItemData(type: 'directory', value: unknown, itemId: string): KnowledgeItemDataMap['directory']
function parseKnowledgeItemData(
  type: keyof KnowledgeItemDataMap,
  value: unknown,
  itemId: string
): KnowledgeItemDataMap[keyof KnowledgeItemDataMap] {
  switch (type) {
    case 'file': {
      const result = fileItemDataSchema.safeParse(value)
      if (result.success) return result.data
      throw new Error(`Invalid knowledge item data for type=file (id=${itemId}): ${result.error.message}`)
    }
    case 'url': {
      const result = urlItemDataSchema.safeParse(value)
      if (result.success) return result.data
      throw new Error(`Invalid knowledge item data for type=url (id=${itemId}): ${result.error.message}`)
    }
    case 'note': {
      const result = noteItemDataSchema.safeParse(value)
      if (result.success) return result.data
      throw new Error(`Invalid knowledge item data for type=note (id=${itemId}): ${result.error.message}`)
    }
    case 'sitemap': {
      const result = sitemapItemDataSchema.safeParse(value)
      if (result.success) return result.data
      throw new Error(`Invalid knowledge item data for type=sitemap (id=${itemId}): ${result.error.message}`)
    }
    case 'directory': {
      const result = directoryDataSchema.safeParse(value)
      if (result.success) return result.data
      throw new Error(`Invalid knowledge item data for type=directory (id=${itemId}): ${result.error.message}`)
    }
    default: {
      const neverType: never = type
      throw new Error(`Unsupported knowledge item type: ${String(neverType)}`)
    }
  }
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

  const rawData = parseJsonValue(row.data, row.id)
  switch (row.type) {
    case 'file':
      const fileData = parseKnowledgeItemData('file', rawData, row.id)
      return { ...base, type: 'file', data: fileData }
    case 'url':
      const urlData = parseKnowledgeItemData('url', rawData, row.id)
      return { ...base, type: 'url', data: urlData }
    case 'note':
      const noteData = parseKnowledgeItemData('note', rawData, row.id)
      return { ...base, type: 'note', data: noteData }
    case 'sitemap':
      const sitemapData = parseKnowledgeItemData('sitemap', rawData, row.id)
      return { ...base, type: 'sitemap', data: sitemapData }
    case 'directory':
      const directoryData = parseKnowledgeItemData('directory', rawData, row.id)
      return { ...base, type: 'directory', data: directoryData }
    default: {
      const neverType: never = row.type
      throw new Error(`Unsupported knowledge item type: ${String(neverType)}`)
    }
  }
}

function buildKnowledgeItemTree(items: KnowledgeItem[]): KnowledgeItemTreeNode[] {
  const childrenMap = new Map<string | null, KnowledgeItem[]>()

  for (const item of items) {
    const parentId = item.parentId ?? null
    if (!childrenMap.has(parentId)) {
      childrenMap.set(parentId, [])
    }
    childrenMap.get(parentId)!.push(item)
  }

  const roots = childrenMap.get(null) ?? []

  const buildNode = (item: KnowledgeItem, path: Set<string>): KnowledgeItemTreeNode => {
    const children = childrenMap.get(item.id) ?? []
    const nextPath = new Set(path)
    nextPath.add(item.id)

    return {
      item,
      children: children.filter((child) => !nextPath.has(child.id)).map((child) => buildNode(child, nextPath))
    }
  }

  return roots.map((root) => buildNode(root, new Set()))
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

  async list(baseId: string): Promise<KnowledgeItemTreeNode[]> {
    const items = await this.listFlat(baseId)
    return buildKnowledgeItemTree(items)
  }

  private async listFlat(baseId: string): Promise<KnowledgeItem[]> {
    const db = dbService.getDb()
    await knowledgeBaseService.getById(baseId)

    const rows = await db
      .select()
      .from(knowledgeItemTable)
      .where(eq(knowledgeItemTable.baseId, baseId))
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

    const parentIds = Array.from(new Set(dto.items.map((item) => item.parentId).filter((id): id is string => !!id)))

    if (parentIds.length > 0) {
      const parentRows = await db
        .select({ id: knowledgeItemTable.id, baseId: knowledgeItemTable.baseId })
        .from(knowledgeItemTable)
        .where(inArray(knowledgeItemTable.id, parentIds))

      const parentMap = new Map(parentRows.map((row) => [row.id, row]))

      for (const parentId of parentIds) {
        const parent = parentMap.get(parentId)
        if (!parent) {
          throw DataApiErrorFactory.notFound('KnowledgeItem', parentId)
        }
        if (parent.baseId !== baseId) {
          throw DataApiErrorFactory.invalidOperation(
            'create knowledge item',
            'Parent knowledge item does not belong to this knowledge base'
          )
        }
      }
    }

    const values: Array<typeof knowledgeItemTable.$inferInsert> = dto.items.map((item) => ({
      baseId,
      parentId: item.parentId ?? null,
      type: item.type,
      data: item.data,
      status: 'idle',
      error: null
    }))

    const rows = await db.insert(knowledgeItemTable).values(values).returning()
    const items = rows.map((row) => rowToKnowledgeItem(row))

    logger.info('Created knowledge items', { baseId, count: items.length })
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
    await this.getById(id)

    const updates: Partial<typeof knowledgeItemTable.$inferInsert> = {}
    if (dto.data !== undefined) updates.data = dto.data
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
