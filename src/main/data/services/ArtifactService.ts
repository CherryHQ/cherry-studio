import { and, count, desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { artifactTable } from '@data/db/schemas/artifact'
import { fileEntryTable } from '@data/db/schemas/file'
import { topicTable } from '@data/db/schemas/topic'
import {
  ARTIFACT_LIST_LIMIT,
  type ArtifactKind,
  type ArtifactList,
  type ListArtifactsQuery
} from '@shared/data/api/schemas/artifacts'
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
