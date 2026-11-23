import path from 'node:path'

import { and, count, desc, eq, inArray, isNotNull, isNull, like, type SQL, sql } from 'drizzle-orm'

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
import type { DbOrTx } from '@data/db/types'
import { isOutsidePath } from '@main/utils/file'
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
import { FILE_TYPE } from '@shared/types/file'
import { fileTypeMap } from '@shared/utils/file'

import { timestampToISO } from './utils/rowMappers'

export interface ReportedAgentArtifact {
  /** Path relative to the session workspace. */
  path: string
  title: string
  /** Bytes, or null when the path is not a readable file. */
  size: number | null
}

export type ArtifactOwner = { agentId: string } | { assistantId: string }

export interface PastAgentReport {
  sessionId: string
  workspacePath: string
  path: string
  title?: string
  reportedAt: number
}

export type PreparedPastAgentReport = Pick<PastAgentReport, 'sessionId' | 'reportedAt'> & ReportedAgentArtifact
interface PastAssistantImage {
  fileEntryId: string
  topicId: string
  reportedAt: number
}

const BACKFILL_KEY = 'artifact:past-outputs:v2'
const RELOCATED_PATH_PREFIX = 'artifact:past-outputs:relocated:'

function asPathList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((path): path is string => typeof path === 'string') : []
}

function workspaceRelativePath(workspacePath: string, filePath: string): string | undefined {
  const relativePath = path.relative(workspacePath, path.resolve(workspacePath, filePath))
  return relativePath && !isOutsidePath(relativePath) ? relativePath.split(path.sep).join('/') : undefined
}

const PAGE_EXTENSIONS = ['html', 'htm', 'md', 'markdown']
const MEDIA_TYPES = new Set<string>([FILE_TYPE.IMAGE, FILE_TYPE.AUDIO, FILE_TYPE.VIDEO])
const MEDIA_EXTENSIONS = Object.entries(fileTypeMap)
  .filter(([, type]) => MEDIA_TYPES.has(type))
  .map(([extension]) => extension)

function getArtifactKind(fileName: SQL): SQL<ArtifactKind> {
  const lowerName = sql`lower(${fileName})`
  const matchesExtension = (extensions: readonly string[]) =>
    sql.join(
      extensions.map((extension) => sql`${lowerName} GLOB ${`*[^/\\].${extension}`}`),
      sql` OR `
    )
  return sql<ArtifactKind>`CASE
    WHEN ${matchesExtension(PAGE_EXTENSIONS)} THEN 'page'
    WHEN ${matchesExtension(MEDIA_EXTENSIONS)} THEN 'media'
    ELSE 'file'
  END`
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
    const changed = application.get('DbService').withWriteTx((tx) => {
      const session = this.getArtifactSession(tx, sessionId)
      if (!session) throw new Error('Artifact session does not exist')
      if (session.agentId !== agentId) return false
      for (const artifact of artifacts) {
        this.upsertAgentArtifactTx(
          tx,
          { agentId, sessionId, workspacePath: session.workspacePath },
          artifact,
          reportedAt
        )
      }
      return true
    })
    if (changed)
      notifyDataApiDataChange([
        { endpoint: '/agents/:agentId/artifacts', kind: 'membership', routeParams: { agentId } }
      ])
  }

  /**
   * Index files generated in an Assistant topic, owned by that topic. Topics that are not
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
      tx.insert(artifactTable)
        .values(
          files.map((file) => {
            const title = file.ext ? `${file.name}.${file.ext}` : file.name
            return { topicId, reportedAt, fileEntryId: file.id, title, size: file.size }
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

  hasBackfilledPastOutputs(): boolean {
    return this.hasBackfilledPastOutputsTx(this.db)
  }

  private hasBackfilledPastOutputsTx(tx: DbOrTx): boolean {
    return Boolean(
      tx.select({ key: appStateTable.key }).from(appStateTable).where(eq(appStateTable.key, BACKFILL_KEY)).get()
    )
  }

  commitPastOutputs(reports: readonly PreparedPastAgentReport[], images: readonly PastAssistantImage[]): void {
    const changed = application.get('DbService').withWriteTx((tx) => {
      if (this.hasBackfilledPastOutputsTx(tx)) return false
      for (const report of reports) {
        const session = this.getArtifactSession(tx, report.sessionId)
        if (!session?.agentId) continue
        this.upsertAgentArtifactTx(
          tx,
          { agentId: session.agentId, sessionId: report.sessionId, workspacePath: session.workspacePath },
          report,
          report.reportedAt
        )
      }
      this.insertPastAssistantImagesTx(tx, images)
      tx.delete(appStateTable)
        .where(like(appStateTable.key, `${RELOCATED_PATH_PREFIX}%`))
        .run()
      tx.insert(appStateTable)
        .values({ key: BACKFILL_KEY, value: { completedAt: Date.now() } })
        .run()
      return true
    })
    if (changed) {
      notifyDataApiDataChange([
        { endpoint: '/agents/:agentId/artifacts', kind: 'membership' },
        { endpoint: '/assistants/:id/artifacts', kind: 'membership' }
      ])
    }
  }

  private getArtifactSession(tx: DbOrTx, sessionId: string) {
    return tx
      .select({ agentId: agentSessionTable.agentId, workspacePath: agentWorkspaceTable.path })
      .from(agentSessionTable)
      .innerJoin(agentWorkspaceTable, eq(agentWorkspaceTable.id, agentSessionTable.workspaceId))
      .where(eq(agentSessionTable.id, sessionId))
      .get()
  }

  private upsertAgentArtifactTx(
    tx: DbOrTx,
    owner: { agentId: string; sessionId: string; workspacePath: string },
    artifact: ReportedAgentArtifact,
    reportedAt: number
  ): void {
    const relativePath = workspaceRelativePath(owner.workspacePath, artifact.path)
    if (!relativePath) return
    const { agentId, sessionId, workspacePath } = owner
    const values = {
      agentId,
      title: artifact.title,
      size: artifact.size,
      reportedAt
    }
    this.rebaseLegacyArtifactTx(tx, sessionId, path.resolve(workspacePath, relativePath), relativePath)
    tx.insert(artifactTable)
      .values({ sessionId, path: relativePath, ...values })
      .onConflictDoUpdate({
        target: [artifactTable.sessionId, artifactTable.path],
        set: values,
        setWhere: sql`excluded.reported_at >= ${artifactTable.reportedAt}`
      })
      .run()
  }

  /** Convert legacy absolute rows before changing their workspace's base directory. */
  rebaseWorkspaceArtifactsTx(tx: DbOrTx, workspaceId: string, oldPath: string): void {
    const rows = tx
      .select({ sessionId: agentSessionTable.id, path: artifactTable.path })
      .from(artifactTable)
      .innerJoin(agentSessionTable, eq(agentSessionTable.id, artifactTable.sessionId))
      .where(eq(agentSessionTable.workspaceId, workspaceId))
      .all()
    for (const row of rows) {
      if (!row.path || !path.isAbsolute(row.path)) continue
      const relativePath = workspaceRelativePath(oldPath, row.path)
      if (relativePath) this.rebaseLegacyArtifactTx(tx, row.sessionId, row.path, relativePath)
    }
    if (this.hasBackfilledPastOutputsTx(tx)) return
    const key = RELOCATED_PATH_PREFIX + workspaceId
    const prior = tx.select({ value: appStateTable.value }).from(appStateTable).where(eq(appStateTable.key, key)).get()
    const value = [...new Set([...asPathList(prior?.value), oldPath])]
    if (prior) tx.update(appStateTable).set({ value }).where(eq(appStateTable.key, key)).run()
    else tx.insert(appStateTable).values({ key, value }).run()
  }

  private rebaseLegacyArtifactTx(tx: DbOrTx, sessionId: string, absolutePath: string, relativePath: string): void {
    const rows = tx
      .select()
      .from(artifactTable)
      .where(and(eq(artifactTable.sessionId, sessionId), inArray(artifactTable.path, [absolutePath, relativePath])))
      .all()
    const legacy = rows.find((row) => row.path === absolutePath)
    if (!legacy) return
    const relative = rows.find((row) => row.path === relativePath)
    if (relative && relative.reportedAt >= legacy.reportedAt) {
      tx.delete(artifactTable).where(eq(artifactTable.id, legacy.id)).run()
      return
    }
    if (relative) tx.delete(artifactTable).where(eq(artifactTable.id, relative.id)).run()
    tx.update(artifactTable).set({ path: relativePath }).where(eq(artifactTable.id, legacy.id)).run()
  }

  /** Include trashed sources. The list applies visibility so restored sessions retain their outputs. */
  readPastAgentReports(): PastAgentReport[] {
    const relocated = new Map(
      this.db
        .select({ key: appStateTable.key, value: appStateTable.value })
        .from(appStateTable)
        .where(like(appStateTable.key, `${RELOCATED_PATH_PREFIX}%`))
        .all()
        .map(({ key, value }) => [key.slice(RELOCATED_PATH_PREFIX.length), asPathList(value)])
    )
    const messages = this.db
      .select({
        sessionId: agentSessionTable.id,
        workspaceId: agentWorkspaceTable.id,
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
          sql`${agentSessionMessageTable.data} LIKE ${`%${REPORT_ARTIFACTS_TOOL_NAME}%`}`
        )
      )
      .all()

    const reports = new Map<string, PastAgentReport>()
    for (const message of messages) {
      for (const call of successfulToolCalls(message.data, isReportArtifactsTool)) {
        const input = reportArtifactsInputSchema.safeParse(call.input)
        if (!input.success) continue
        for (const artifact of input.data.artifacts) {
          const relativePath =
            workspaceRelativePath(message.workspacePath, artifact.path) ??
            relocated
              .get(message.workspaceId)
              ?.map((root) => workspaceRelativePath(root, artifact.path))
              .find(Boolean)
          if (!relativePath) continue
          const key = `${message.sessionId}\n${relativePath}`
          if ((reports.get(key)?.reportedAt ?? -1) > message.createdAt) continue
          reports.set(key, {
            sessionId: message.sessionId,
            workspacePath: message.workspacePath,
            path: relativePath,
            title: artifact.description,
            reportedAt: message.createdAt
          })
        }
      }
    }
    return [...reports.values()]
  }

  /** Images from successful tool calls, including those in restorable topics. */
  readPastAssistantImages(): PastAssistantImage[] {
    const messages = this.db
      .select({ topicId: topicTable.id, data: messageTable.data, createdAt: messageTable.createdAt })
      .from(messageTable)
      .innerJoin(topicTable, eq(topicTable.id, messageTable.topicId))
      .where(
        and(
          isNotNull(topicTable.assistantId),
          isNull(messageTable.deletedAt),
          sql`${messageTable.data} LIKE ${`%${GENERATE_IMAGE_TOOL_NAME}%`}`
        )
      )
      .all()
    const images = new Map<string, PastAssistantImage>()
    for (const message of messages) {
      for (const call of successfulToolCalls(message.data, (name) => name === GENERATE_IMAGE_TOOL_NAME)) {
        const output = Array.isArray(call.output) ? call.output : (call.output as { content?: unknown })?.content
        if (!Array.isArray(output)) continue
        for (const item of output) {
          const image = generateImageOutputItemSchema.safeParse(item)
          if (!image.success) continue
          const key = `${message.topicId}\n${image.data.id}`
          if ((images.get(key)?.reportedAt ?? -1) > message.createdAt) continue
          images.set(key, { fileEntryId: image.data.id, topicId: message.topicId, reportedAt: message.createdAt })
        }
      }
    }
    return [...images.values()]
  }

  private insertPastAssistantImagesTx(tx: DbOrTx, images: readonly PastAssistantImage[]): void {
    if (!images.length) return
    const indexed = new Set(
      tx
        .select({ topicId: artifactTable.topicId, fileEntryId: artifactTable.fileEntryId })
        .from(artifactTable)
        .where(isNotNull(artifactTable.topicId))
        .all()
        .map((row) => `${row.topicId}\n${row.fileEntryId}`)
    )
    for (const image of images) {
      if (indexed.has(`${image.topicId}\n${image.fileEntryId}`)) continue
      const topic = tx
        .select({ assistantId: topicTable.assistantId })
        .from(topicTable)
        .where(eq(topicTable.id, image.topicId))
        .get()
      if (!topic?.assistantId) continue
      const file = tx
        .select({ name: fileEntryTable.name, ext: fileEntryTable.ext, size: fileEntryTable.size })
        .from(fileEntryTable)
        .where(eq(fileEntryTable.id, image.fileEntryId))
        .get()
      if (!file) continue
      const title = file.ext ? `${file.name}.${file.ext}` : file.name
      tx.insert(artifactTable)
        .values({ ...image, title, size: file.size })
        .run()
    }
  }

  /** Outputs from the owner's live sessions or topics, newest first, with the totals of every kind. */
  list(owner: ArtifactOwner, query: ListArtifactsQuery = {}): ArtifactList {
    const source =
      'agentId' in owner
        ? {
            owned: and(eq(artifactTable.agentId, owner.agentId), eq(agentSessionTable.agentId, owner.agentId)),
            table: agentSessionTable,
            join: eq(agentSessionTable.id, artifactTable.sessionId),
            live: isNull(agentSessionTable.deletedAt),
            id: agentSessionTable.id,
            name: agentSessionTable.name,
            workspacePath: sql<
              string | null
            >`(SELECT ${agentWorkspaceTable.path} FROM ${agentWorkspaceTable} WHERE ${agentWorkspaceTable.id} = ${agentSessionTable.workspaceId})`
          }
        : {
            owned: eq(topicTable.assistantId, owner.assistantId),
            table: topicTable,
            join: eq(topicTable.id, artifactTable.topicId),
            // Drop outputs whose managed file is gone; the row has no FK so it cannot pin the file.
            live: and(isNull(topicTable.deletedAt), isNotNull(fileEntryTable.id)),
            id: topicTable.id,
            name: topicTable.name,
            workspacePath: sql<null>`NULL`
          }
    const where = (...extra: (SQL | undefined)[]) => and(source.owned, source.live, ...extra)
    const fileJoin = eq(fileEntryTable.id, artifactTable.fileEntryId)
    const kind = getArtifactKind(
      sql`coalesce(${artifactTable.path}, ${fileEntryTable.name} || '.' || nullif(${fileEntryTable.ext}, ''), ${fileEntryTable.name})`
    )

    const rows = this.db
      .select({
        artifact: artifactTable,
        kind,
        sourceId: source.id,
        sourceName: source.name,
        workspacePath: source.workspacePath
      })
      .from(artifactTable)
      .innerJoin(source.table, source.join)
      .leftJoin(fileEntryTable, fileJoin)
      .where(where(query.kind ? eq(kind, query.kind) : undefined))
      .orderBy(desc(artifactTable.reportedAt), desc(sql`${artifactTable}.rowid`))
      .limit(ARTIFACT_LIST_LIMIT)
      .all()
    const totals = this.db
      .select({ kind, count: count() })
      .from(artifactTable)
      .innerJoin(source.table, source.join)
      .leftJoin(fileEntryTable, fileJoin)
      .where(where())
      .groupBy(kind)
      .all()

    const counts = { all: 0, page: 0, media: 0, file: 0 }
    for (const total of totals) {
      counts[total.kind] = total.count
      counts.all += total.count
    }
    return {
      items: rows.map(({ artifact, kind, sourceId, sourceName, workspacePath }) => ({
        id: artifact.id,
        sourceId,
        sourceName,
        path:
          artifact.path && workspacePath && workspaceRelativePath(workspacePath, artifact.path)
            ? path.resolve(workspacePath, artifact.path)
            : undefined,
        fileEntryId: artifact.fileEntryId ?? undefined,
        title: artifact.title,
        kind,
        size: artifact.size ?? undefined,
        reportedAt: timestampToISO(artifact.reportedAt)
      })),
      counts
    }
  }
}

export const artifactService = new ArtifactService()
