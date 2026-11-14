import path from 'node:path'

import { and, count, desc, eq, inArray, isNotNull, isNull, type SQL, sql } from 'drizzle-orm'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import { artifactTable } from '@data/db/schemas/artifact'
import { fileEntryTable } from '@data/db/schemas/file'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import {
  GENERATE_IMAGE_TOOL_NAME,
  generateImageOutputItemSchema,
  REPORT_ARTIFACTS_TOOL_NAME,
  reportArtifactsInputSchema
} from '@shared/ai/builtinTools'
import {
  ARTIFACT_LIST_LIMIT,
  type ArtifactKind,
  type ArtifactList,
  type ListArtifactsQuery
} from '@shared/data/api/schemas/artifacts'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import { FILE_TYPE } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'

import { timestampToISO } from './utils/rowMappers'

export interface ReportedAgentArtifact {
  /** Absolute path. */
  path: string
  title: string
  /** Bytes, or null when the path is not a readable file. */
  size: number | null
}

export type ArtifactOwner = { agentId: string } | { assistantId: string }

/** A deliverable an Agent session reported before outputs were indexed. */
export interface PastAgentReport extends ReportedAgentArtifact {
  agentId: string
  sessionId: string
  /** When the reporting message was created. */
  reportedAt: number
}

// Done-event app_state key: never rename once shipped, or every install backfills again.
const BACKFILL_KEY = 'artifact:pastOutputsBackfill'

const PAGE_EXTENSIONS = new Set(['html', 'htm', 'md', 'markdown'])
const MEDIA_TYPES = new Set<string>([FILE_TYPE.IMAGE, FILE_TYPE.AUDIO, FILE_TYPE.VIDEO])

/** HTML and Markdown are pages; images, audio and video are media; everything else is a file. */
export function getArtifactKind(fileName: string): ArtifactKind {
  const name = fileName.split(/[\\/]/).at(-1) ?? ''
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (PAGE_EXTENSIONS.has(extension)) return 'page'
  return MEDIA_TYPES.has(getFileTypeByExt(extension)) ? 'media' : 'file'
}

type StoredToolCall = { input?: unknown; output?: unknown }

/** The successful calls of a tool in a stored message's parts; malformed parts are skipped. */
function successfulToolCalls(data: unknown, isTool: (name: string) => boolean): StoredToolCall[] {
  const parts = (data as { parts?: unknown } | null)?.parts
  if (!Array.isArray(parts)) return []
  return parts.filter((part) => {
    const type = part?.type
    if (typeof type !== 'string' || part.state !== 'output-available') return false
    const name = type === 'dynamic-tool' ? part.toolName : type.startsWith('tool-') ? type.slice(5) : undefined
    return typeof name === 'string' && isTool(name)
  })
}

const isReportArtifactsTool = (name: string) =>
  name === REPORT_ARTIFACTS_TOOL_NAME || name.endsWith(`__${REPORT_ARTIFACTS_TOOL_NAME}`)

export class ArtifactService {
  private get db() {
    return application.get('DbService').getDb()
  }

  /** Index what an Agent session reported; a path the session already reported is refreshed, not duplicated. */
  recordAgentArtifacts(agentId: string, sessionId: string, artifacts: readonly ReportedAgentArtifact[]): void {
    if (!artifacts.length) return
    const reportedAt = Date.now()
    application.get('DbService').withWriteTx((tx) => {
      for (const artifact of artifacts) {
        const values = { title: artifact.title, kind: getArtifactKind(artifact.path), size: artifact.size, reportedAt }
        tx.insert(artifactTable)
          .values({ agentId, sessionId, path: artifact.path, ...values })
          .onConflictDoUpdate({ target: [artifactTable.sessionId, artifactTable.path], set: values })
          .run()
      }
    })
    notifyDataApiDataChange([{ endpoint: '/agents/:agentId/artifacts', kind: 'membership', routeParams: { agentId } }])
  }

  /**
   * Index files generated in an Assistant topic, owned by the topic's Assistant. Topics that are not
   * stored (temporary chats) or have no Assistant, and files that no longer exist, are skipped.
   */
  recordTopicFiles(topicId: string, fileEntryIds: readonly string[]): void {
    if (!fileEntryIds.length) return
    const reportedAt = Date.now()
    const assistantId = application.get('DbService').withWriteTx((tx) => {
      const topic = tx
        .select({ assistantId: topicTable.assistantId })
        .from(topicTable)
        .where(eq(topicTable.id, topicId))
        .get()
      if (!topic?.assistantId) return null
      const files = tx
        .select({
          id: fileEntryTable.id,
          name: fileEntryTable.name,
          ext: fileEntryTable.ext,
          size: fileEntryTable.size
        })
        .from(fileEntryTable)
        .where(inArray(fileEntryTable.id, [...fileEntryIds]))
        .all()
      if (!files.length) return null
      const owner = { assistantId: topic.assistantId, topicId, reportedAt }
      tx.insert(artifactTable)
        .values(
          files.map((file) => {
            const title = file.ext ? `${file.name}.${file.ext}` : file.name
            return { ...owner, fileEntryId: file.id, title, kind: getArtifactKind(title), size: file.size }
          })
        )
        .run()
      return topic.assistantId
    })
    if (assistantId)
      notifyDataApiDataChange([
        { endpoint: '/assistants/:id/artifacts', kind: 'membership', routeParams: { id: assistantId } }
      ])
  }

  /**
   * Deliverables reported in live Agent sessions, one per session and path with its newest report,
   * or null once the past outputs are backfilled. Paths resolve against the session workspace.
   */
  findPastAgentReports(): Omit<PastAgentReport, 'size'>[] | null {
    if (this.db.select().from(appStateTable).where(eq(appStateTable.key, BACKFILL_KEY)).get()) return null
    const messages = this.db
      .select({
        agentId: agentSessionTable.agentId,
        sessionId: agentSessionTable.id,
        workspacePath: agentWorkspaceTable.path,
        data: agentSessionMessageTable.data,
        createdAt: agentSessionMessageTable.createdAt
      })
      .from(agentSessionMessageTable)
      .innerJoin(agentSessionTable, eq(agentSessionTable.id, agentSessionMessageTable.sessionId))
      .innerJoin(agentWorkspaceTable, eq(agentWorkspaceTable.id, agentSessionTable.workspaceId))
      .where(
        and(
          isNotNull(agentSessionTable.agentId),
          isNull(agentSessionTable.deletedAt),
          sql`${agentSessionMessageTable.data} LIKE ${`%${REPORT_ARTIFACTS_TOOL_NAME}%`}`
        )
      )
      .all()

    const reports = new Map<string, Omit<PastAgentReport, 'size'>>()
    for (const message of messages) {
      for (const call of successfulToolCalls(message.data, isReportArtifactsTool)) {
        const input = reportArtifactsInputSchema.safeParse(call.input)
        if (!input.success) continue
        for (const artifact of input.data.artifacts) {
          const filePath = path.resolve(message.workspacePath, artifact.path)
          const key = `${message.sessionId}\n${filePath}`
          if ((reports.get(key)?.reportedAt ?? -1) > message.createdAt) continue
          reports.set(key, {
            agentId: message.agentId!,
            sessionId: message.sessionId,
            path: filePath,
            title: artifact.description ?? path.basename(filePath),
            reportedAt: message.createdAt
          })
        }
      }
    }
    return [...reports.values()]
  }

  /**
   * Index outputs created before this index existed: the given past Agent reports, and the images
   * `generate_image` made in live Assistant topics. A row already indexed keeps its newer report.
   */
  backfillPastOutputs(agentReports: readonly PastAgentReport[]): void {
    const owners = application.get('DbService').withWriteTx((tx) => {
      const agentIds = new Set<string>()
      for (const { agentId, sessionId, path: filePath, title, size, reportedAt } of agentReports) {
        const values = { title, kind: getArtifactKind(filePath), size, reportedAt }
        const { changes } = tx
          .insert(artifactTable)
          .values({ agentId, sessionId, path: filePath, ...values })
          .onConflictDoUpdate({
            target: [artifactTable.sessionId, artifactTable.path],
            set: values,
            setWhere: sql`excluded.reported_at > ${artifactTable.reportedAt}`
          })
          .run()
        if (changes) agentIds.add(agentId)
      }

      const messages = tx
        .select({
          topicId: topicTable.id,
          assistantId: topicTable.assistantId,
          data: messageTable.data,
          createdAt: messageTable.createdAt
        })
        .from(messageTable)
        .innerJoin(topicTable, eq(topicTable.id, messageTable.topicId))
        .where(
          and(
            isNotNull(topicTable.assistantId),
            isNull(topicTable.deletedAt),
            isNull(messageTable.deletedAt),
            sql`${messageTable.data} LIKE ${`%${GENERATE_IMAGE_TOOL_NAME}%`}`
          )
        )
        .all()
      const indexed = new Set(
        tx
          .select({ topicId: artifactTable.topicId, fileEntryId: artifactTable.fileEntryId })
          .from(artifactTable)
          .where(isNotNull(artifactTable.topicId))
          .all()
          .map((row) => `${row.topicId}\n${row.fileEntryId}`)
      )
      const images = new Map<string, { topicId: string; assistantId: string; reportedAt: number }>()
      for (const message of messages) {
        for (const call of successfulToolCalls(message.data, (name) => name === GENERATE_IMAGE_TOOL_NAME)) {
          const output = Array.isArray(call.output) ? call.output : (call.output as { content?: unknown })?.content
          if (!Array.isArray(output)) continue
          for (const item of output) {
            const image = generateImageOutputItemSchema.safeParse(item)
            if (!image.success || indexed.has(`${message.topicId}\n${image.data.id}`)) continue
            images.set(image.data.id, {
              topicId: message.topicId,
              assistantId: message.assistantId!,
              reportedAt: message.createdAt
            })
          }
        }
      }
      const assistantIds = new Set<string>()
      if (images.size) {
        const files = tx
          .select({
            id: fileEntryTable.id,
            name: fileEntryTable.name,
            ext: fileEntryTable.ext,
            size: fileEntryTable.size
          })
          .from(fileEntryTable)
          .where(inArray(fileEntryTable.id, [...images.keys()]))
          .all()
        for (const file of files) {
          const owner = images.get(file.id)!
          const title = file.ext ? `${file.name}.${file.ext}` : file.name
          tx.insert(artifactTable)
            .values({ ...owner, fileEntryId: file.id, title, kind: getArtifactKind(title), size: file.size })
            .run()
          assistantIds.add(owner.assistantId)
        }
      }

      tx.insert(appStateTable)
        .values({ key: BACKFILL_KEY, value: { completedAt: Date.now() }, description: 'Past outputs are indexed' })
        .onConflictDoNothing()
        .run()
      return { agentIds, assistantIds }
    })
    notifyDataApiDataChange([
      ...[...owners.agentIds].map(
        (agentId): DataApiDataChangeEffect => ({
          endpoint: '/agents/:agentId/artifacts',
          kind: 'membership',
          routeParams: { agentId }
        })
      ),
      ...[...owners.assistantIds].map(
        (id): DataApiDataChangeEffect => ({
          endpoint: '/assistants/:id/artifacts',
          kind: 'membership',
          routeParams: { id }
        })
      )
    ])
  }

  /** Outputs from the owner's live sessions or topics, newest first, with the totals of every kind. */
  list(owner: ArtifactOwner, query: ListArtifactsQuery = {}): ArtifactList {
    const source =
      'agentId' in owner
        ? {
            owned: eq(artifactTable.agentId, owner.agentId),
            table: agentSessionTable,
            join: eq(agentSessionTable.id, artifactTable.sessionId),
            live: isNull(agentSessionTable.deletedAt),
            id: agentSessionTable.id,
            name: agentSessionTable.name
          }
        : {
            owned: eq(artifactTable.assistantId, owner.assistantId),
            table: topicTable,
            join: eq(topicTable.id, artifactTable.topicId),
            // Drop outputs whose managed file is gone; the row has no FK so it cannot pin the file.
            live: and(
              isNull(topicTable.deletedAt),
              sql`EXISTS (SELECT 1 FROM ${fileEntryTable} WHERE ${fileEntryTable.id} = ${artifactTable.fileEntryId})`
            ),
            id: topicTable.id,
            name: topicTable.name
          }
    const where = (...extra: (SQL | undefined)[]) => and(source.owned, source.live, ...extra)

    const rows = this.db
      .select({ artifact: artifactTable, sourceId: source.id, sourceName: source.name })
      .from(artifactTable)
      .innerJoin(source.table, source.join)
      .where(where(query.kind ? eq(artifactTable.kind, query.kind) : undefined))
      .orderBy(desc(artifactTable.reportedAt), desc(sql`${artifactTable}.rowid`))
      .limit(ARTIFACT_LIST_LIMIT)
      .all()
    const totals = this.db
      .select({ kind: artifactTable.kind, count: count() })
      .from(artifactTable)
      .innerJoin(source.table, source.join)
      .where(where())
      .groupBy(artifactTable.kind)
      .all()

    const counts = { all: 0, page: 0, media: 0, file: 0 }
    for (const total of totals) {
      counts[total.kind] = total.count
      counts.all += total.count
    }
    return {
      items: rows.map(({ artifact, sourceId, sourceName }) => ({
        id: artifact.id,
        sourceId,
        sourceName,
        path: artifact.path ?? undefined,
        fileEntryId: artifact.fileEntryId ?? undefined,
        title: artifact.title,
        kind: artifact.kind,
        size: artifact.size ?? undefined,
        reportedAt: timestampToISO(artifact.reportedAt)
      })),
      counts
    }
  }
}

export const artifactService = new ArtifactService()
