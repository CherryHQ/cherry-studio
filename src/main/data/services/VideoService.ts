import { randomUUID } from 'node:crypto'

import { and, desc, eq, sql, type SQL } from 'drizzle-orm'

import { application } from '@application'
import { videoTable } from '@main/data/db/schemas/video'
import type { ListVideosQuery, VideoListResponse } from '@shared/data/api/schemas/videos'
import type { Video } from '@shared/data/types/video'

function toVideo(row: typeof videoTable.$inferSelect): Video {
  return {
    id: row.id,
    providerId: row.providerId,
    modelId: row.modelId,
    prompt: row.prompt,
    duration: row.duration,
    resolution: row.resolution,
    status: row.status as Video['status'],
    providerTaskId: row.providerTaskId,
    videoUrl: row.videoUrl,
    errorMessage: row.errorMessage,
    jobId: row.jobId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

class VideoService {
  create(input: {
    providerId: string
    modelId: string
    prompt: string
    duration?: number
    resolution?: string
  }): Video {
    const db = application.get('DbService').getDb()
    const now = Date.now()
    const id = randomUUID()
    db.insert(videoTable)
      .values({
        id,
        providerId: input.providerId,
        modelId: input.modelId,
        prompt: input.prompt,
        duration: input.duration ?? null,
        resolution: input.resolution ?? null,
        status: 'pending',
        createdAt: now,
        updatedAt: now
      })
      .run()
    const row = db.select().from(videoTable).where(eq(videoTable.id, id)).get()
    if (!row) throw new Error(`VideoService: insert failed for id ${id}`)
    return toVideo(row)
  }

  getById(id: string): Video {
    const db = application.get('DbService').getDb()
    const row = db.select().from(videoTable).where(eq(videoTable.id, id)).get()
    if (!row) throw new Error(`Video not found: ${id}`)
    return toVideo(row)
  }

  list(query: ListVideosQuery): VideoListResponse {
    const db = application.get('DbService').getDb()
    const conditions: SQL[] = []
    if (query.providerId) conditions.push(eq(videoTable.providerId, query.providerId))
    if (query.status) conditions.push(eq(videoTable.status, query.status))

    const where: SQL | undefined = conditions.length > 0 ? and(...conditions) : undefined
    const limit = query.limit

    const rows = db
      .select()
      .from(videoTable)
      .where(where)
      .orderBy(desc(videoTable.createdAt))
      .limit(limit + 1)
      .all()

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? items[items.length - 1]?.id : undefined

    const countResult = db
      .select({ count: sql<number>`count(*)` })
      .from(videoTable)
      .where(where)
      .all()
    const total = countResult[0]?.count ?? 0

    return {
      items: items.map(toVideo),
      total,
      nextCursor
    }
  }

  delete(id: string): void {
    const db = application.get('DbService').getDb()
    db.delete(videoTable).where(eq(videoTable.id, id)).run()
  }
}

export const videoService = new VideoService()
