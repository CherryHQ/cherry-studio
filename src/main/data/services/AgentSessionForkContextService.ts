import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'
import { omit } from 'es-toolkit/compat'

import { application } from '@application'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionForkContextTable as table } from '@data/db/schemas/agentSessionForkContext'
import type { AgentSessionMessageRow } from '@data/db/schemas/agentSessionMessage'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import type { DbOrTx } from '@data/db/types'
import {
  type ForkContextCompatibility,
  type ForkContextDocument,
  ForkContextDocumentSchema,
  type ForkContextError,
  ForkContextSummarySchema,
  PreparedForkContextSchema,
  upgradeForkContextDocument
} from '@data/services/agentSessionForkContext'

import { agentSessionEditService } from './AgentSessionEditService'
import { getAgentSessionForkAvailability } from './agentSessionFork'
import { agentSessionMessageService } from './AgentSessionMessageService'
import {
  collectForkContextGarbage,
  createForkContextSnapshot,
  forkContextHash,
  forkContextSegment,
  nativeForkContextText,
  selectForkContextSummary
} from './utils/forkContext'

export class ForkContextFailure extends Error {
  constructor(readonly detail: ForkContextError) {
    super(`Fork context: ${detail.code}`)
    this.name = 'ForkContextFailure'
  }
}

export interface NativeForkContextCapture {
  sessionId: string
  messageId: string
  excludedIds: readonly string[]
  checkpointHash: string
  prefixHash: string
}

export class AgentSessionForkContextService {
  replaceForEditTx(tx: DbOrTx, sessionId: string, document?: ForkContextDocument): void {
    tx.delete(table).where(eq(table.sessionId, sessionId)).run()
    if (document)
      tx.insert(table)
        .values({ sessionId, document: ForkContextDocumentSchema.parse(document) })
        .run()
  }
  captureNativePrefix(
    sessionId: string,
    messageId: string,
    excludedIds: readonly string[],
    expectedState: unknown
  ): NativeForkContextCapture | undefined {
    const rows = agentSessionMessageService.readForkPrefixTx(
      application.get('DbService').getDb(),
      sessionId,
      messageId,
      excludedIds
    )
    const state = rows.at(-1)?.runtimeForkState
    if (
      getAgentSessionForkAvailability(state).status !== 'available' ||
      forkContextHash(state) !== forkContextHash(expectedState)
    )
      return undefined
    return {
      sessionId,
      messageId,
      excludedIds: [...excludedIds],
      checkpointHash: forkContextHash(state),
      prefixHash: forkContextHash(rows)
    }
  }

  recordNative(
    sessionId: string,
    messageId: string,
    excludedIds: readonly string[],
    compatibility: ForkContextCompatibility,
    native: { identity: string; messages: unknown[] },
    capture: NativeForkContextCapture
  ): void {
    if (compatibility.runtime === 'claude-code') return
    if (
      capture.sessionId !== sessionId ||
      capture.messageId !== messageId ||
      forkContextHash(capture.excludedIds) !== forkContextHash(excludedIds)
    )
      return
    const text = nativeForkContextText(native.messages)
    if (!text) return
    application.get('DbService').withWriteTx((tx) => {
      const rows = agentSessionMessageService.readForkPrefixTx(tx, sessionId, messageId, excludedIds)
      if (
        forkContextHash(rows) !== capture.prefixHash ||
        forkContextHash(rows.at(-1)?.runtimeForkState) !== capture.checkpointHash
      )
        return
      const row = tx.select().from(table).where(eq(table.sessionId, sessionId)).get()
      const parsed = ForkContextDocumentSchema.safeParse(upgradeForkContextDocument(row?.document))
      if (row && !parsed.success) return
      if (
        parsed.success &&
        parsed.data.summaries.some(
          (summary) =>
            summary.nativeIdentity === native.identity &&
            forkContextHash(summary.compatibility) === forkContextHash(compatibility)
        )
      )
        return
      const snapshot = createForkContextSnapshot(rows)
      const document: ForkContextDocument = parsed.success
        ? parsed.data
        : { version: 2, snapshot, summaries: [], state: 'forkCreated', audits: [] }
      if (parsed.success) {
        if (document.state === 'sending' || document.error?.category === 'needs_reconciliation') return
        if (
          !document.snapshot.entries.every((entry, index) => entry.contentHash === snapshot.entries[index]?.contentHash)
        )
          return
        snapshot.snapshotId = document.snapshot.snapshotId
      }
      snapshot.hadCompaction = true
      document.snapshot = snapshot
      const segment = forkContextSegment(snapshot, 0, snapshot.entries.length, text, 'summary')
      const summaryId = randomUUID()
      document.summaries.push({
        summaryId,
        parentSummaryId: selectForkContextSummary(document, compatibility)?.summaryId,
        sourceType: 'native',
        nativeIdentity: native.identity,
        captureProof: { checkpointHash: capture.checkpointHash, prefixHash: capture.prefixHash },
        compatibility,
        coveredStart: 0,
        coveredEnd: snapshot.entries.length,
        inputSnapshotId: snapshot.snapshotId,
        inputSnapshotHash: snapshot.hash,
        inputMessageIds: snapshot.entries.map((entry) => entry.messageId),
        segments: [segment],
        retainedSegments: [],
        layout: [segment.segmentId]
      })
      document.headSummaryId = summaryId
      collectForkContextGarbage(document)
      if (row)
        tx.update(table)
          .set({ document, revision: row.revision + 1 })
          .where(eq(table.sessionId, sessionId))
          .run()
      else tx.insert(table).values({ sessionId, document }).run()
    })
  }

  createTx(
    tx: DbOrTx,
    sessionId: string,
    rows: readonly AgentSessionMessageRow[],
    sourceSessionId?: string,
    sourceRows?: readonly AgentSessionMessageRow[]
  ): void {
    const document = this.createDocumentTx(tx, rows, sourceSessionId, sourceRows)
    tx.insert(table).values({ sessionId, document }).run()
  }

  /** Build a bounded, detached context without replacing the live session's send receipts. */
  createDocumentTx(
    tx: DbOrTx,
    rows: readonly AgentSessionMessageRow[],
    sourceSessionId?: string,
    sourceRows?: readonly AgentSessionMessageRow[]
  ): ForkContextDocument {
    const snapshot = createForkContextSnapshot(rows)
    const document: ForkContextDocument = { version: 2, snapshot, summaries: [], state: 'forkCreated', audits: [] }
    const parentRow = sourceSessionId
      ? tx.select().from(table).where(eq(table.sessionId, sourceSessionId)).get()
      : undefined
    const parsed = ForkContextDocumentSchema.safeParse(upgradeForkContextDocument(parentRow?.document))
    if (parsed.success) {
      const parent = parsed.data
      const source = createForkContextSnapshot(sourceRows ?? [])
      const head = parent.summaries.find((summary) => summary.summaryId === parent.headSummaryId)
      const verified = head && selectForkContextSummary(parent, head.compatibility)
      const limit = Math.min(snapshot.entries.length, parent.snapshot.entries.length)
      if (
        verified &&
        source.entries.length >= limit &&
        source.entries
          .slice(0, limit)
          .every((entry, index) => entry.contentHash === parent.snapshot.entries[index].contentHash) &&
        parent.snapshot.entries
          .slice(0, limit)
          .every(
            (entry, index) => entry.text === snapshot.entries[index].text && entry.role === snapshot.entries[index].role
          )
      ) {
        let headId: string | undefined = parent.headSummaryId
        while (
          headId &&
          parent.summaries.find((summary) => summary.summaryId === headId)!.coveredEnd > snapshot.entries.length
        )
          headId = parent.summaries.find((summary) => summary.summaryId === headId)!.parentSummaryId
        const ancestors = new Set<string>()
        for (let id = headId; id; id = parent.summaries.find((summary) => summary.summaryId === id)!.parentSummaryId)
          ancestors.add(id)
        const inherited = parent.summaries.filter((summary) => ancestors.has(summary.summaryId))
        const ids = new Map(parent.summaries.map((summary) => [summary.summaryId, randomUUID()]))
        document.summaries = inherited.map((summary) => {
          const remap = (segment: (typeof summary.segments)[number]) => {
            const content = omit(segment, ['contentHash'])
            const changed = {
              ...content,
              sourceSnapshotId: snapshot.snapshotId,
              sourceMessageIds: segment.sourceRanges.flatMap(({ start, end }) =>
                snapshot.entries.slice(start, end).map((e) => e.messageId)
              )
            }
            return { ...changed, contentHash: forkContextHash(changed) }
          }
          return {
            ...summary,
            summaryId: ids.get(summary.summaryId)!,
            parentSummaryId: summary.parentSummaryId ? ids.get(summary.parentSummaryId) : undefined,
            inputSnapshotId: snapshot.snapshotId,
            inputSnapshotHash: forkContextHash(snapshot.entries.slice(0, summary.coveredEnd)),
            inputMessageIds: snapshot.entries.slice(0, summary.coveredEnd).map((entry) => entry.messageId),
            segments: summary.segments.map(remap),
            retainedSegments: summary.retainedSegments.map(remap)
          }
        })
        document.headSummaryId = headId ? ids.get(headId) : undefined
      }
    }
    return document
  }

  get(sessionId: string): { document: ForkContextDocument; revision: number } | undefined {
    const row = application.get('DbService').getDb().select().from(table).where(eq(table.sessionId, sessionId)).get()
    if (!row) return undefined
    const upgraded = upgradeForkContextDocument(row.document)
    const parsed = ForkContextDocumentSchema.safeParse(upgraded)
    if (!parsed.success) {
      // A damaged summary is disposable, but never discard send receipts or guess a snapshot.
      const raw = upgraded
      if (raw && typeof raw === 'object' && 'summaries' in raw && Array.isArray(raw.summaries)) {
        const base = ForkContextDocumentSchema.omit({ summaries: true, prepared: true }).safeParse(
          omit(raw, ['summaries', 'prepared'])
        )
        if (
          base.success &&
          !['sending', 'sent'].includes(base.data.state) &&
          base.data.error?.category !== 'needs_reconciliation'
        ) {
          const prepared = PreparedForkContextSchema.safeParse('prepared' in raw ? raw.prepared : undefined)
          return {
            revision: row.revision,
            document: {
              ...base.data,
              snapshot: {
                ...base.data.snapshot,
                hadCompaction: base.data.snapshot.hadCompaction || raw.summaries.length > 0
              },
              summaries: raw.summaries.flatMap((value) => {
                const summary = ForkContextSummarySchema.safeParse(value)
                return summary.success ? [summary.data] : []
              }),
              prepared: prepared.success ? prepared.data : undefined
            }
          }
        }
      }
      throw new ForkContextFailure({ code: 'corrupt', category: 'not_retryable' })
    }
    if (upgraded !== row.document) {
      const revision = this.save(sessionId, row.revision, parsed.data)
      return { document: parsed.data, revision }
    }
    return { document: parsed.data, revision: row.revision }
  }

  ensure(sessionId: string): ReturnType<AgentSessionForkContextService['get']> {
    const existing = this.get(sessionId)
    if (existing) return existing
    const rows = agentSessionMessageService.getForkHistory(sessionId)
    if (!rows) return undefined
    // Without an audit, any post-fork assistant row may represent a delivered prompt.
    // Initialization tokens on inherited rows, by contrast, never establish delivery.
    const inheritedIds = new Set(rows.map((row) => row.id))
    const subsequent = application
      .get('DbService')
      .getDb()
      .select({ id: agentSessionMessageTable.id })
      .from(agentSessionMessageTable)
      .where(and(eq(agentSessionMessageTable.sessionId, sessionId), eq(agentSessionMessageTable.role, 'assistant')))
      .all()
      .some((row) => !inheritedIds.has(row.id))
    if (subsequent) throw new ForkContextFailure({ code: 'native_uncertain', category: 'needs_reconciliation' })
    application.get('DbService').withWriteTx((tx) => {
      if (!tx.select().from(table).where(eq(table.sessionId, sessionId)).get()) this.createTx(tx, sessionId, rows)
    })
    return this.get(sessionId)
  }

  save(sessionId: string, revision: number, document: ForkContextDocument): number {
    collectForkContextGarbage(document)
    const parsed = ForkContextDocumentSchema.parse(document)
    const result = application
      .get('DbService')
      .getDb()
      .update(table)
      .set({ document: parsed, revision: revision + 1 })
      .where(and(eq(table.sessionId, sessionId), eq(table.revision, revision)))
      .run()
    if (!result.changes) throw new ForkContextFailure({ code: 'boundary', category: 'not_retryable' })
    return revision + 1
  }

  /** An initialization token never proves that the inherited context was delivered. */
  needsPreparation(sessionId: string): boolean {
    const edit = agentSessionEditService.current(sessionId)
    const source = application
      .get('DbService')
      .getDb()
      .select({ source: agentSessionTable.forkedFrom })
      .from(agentSessionTable)
      .where(eq(agentSessionTable.id, sessionId))
      .get()
    if (edit ? !edit.rebuilt : !source?.source?.historyMessageId) return false
    this.reconcileReceipt(sessionId)
    const current = this.ensure(sessionId)
    if (!current) throw new ForkContextFailure({ code: 'corrupt', category: 'not_retryable' })
    const { document } = current
    if (document.state === 'sent') {
      if (!document.audits.some((audit) => audit.outcome === 'sent' && audit.resumeToken))
        throw new ForkContextFailure({ code: 'native_uncertain', category: 'needs_reconciliation' })
      return false
    }
    if (
      document.state === 'sending' ||
      document.error?.category === 'needs_reconciliation' ||
      document.audits.some((audit) => audit.outcome !== 'sent')
    )
      throw new ForkContextFailure({ code: 'native_uncertain', category: 'needs_reconciliation' })
    return true
  }

  beginSend(sessionId: string, preparedContextId: string, messageId: string, assistantMessageId: string): string {
    const current = this.get(sessionId)
    if (!current || current.document.prepared?.preparedContextId !== preparedContextId)
      throw new ForkContextFailure({ code: 'boundary', category: 'not_retryable' })
    const { document, revision } = current
    if (
      document.state === 'sending' ||
      document.state === 'sent' ||
      document.error?.category === 'needs_reconciliation'
    )
      throw new ForkContextFailure({ code: 'native_uncertain', category: 'needs_reconciliation' })
    const prepared = document.prepared!
    const attemptId = randomUUID()
    document.audits.push({
      attemptId,
      preparedContextId,
      summaryId: prepared.summaryId,
      snapshotId: document.snapshot.snapshotId,
      coveredEnd: document.snapshot.entries.length,
      segmentHashes: prepared.segments.map((segment) => segment.contentHash),
      historyHash: prepared.historyHash,
      messageId,
      assistantMessageId,
      compatibility: prepared.compatibility,
      submittedAt: Date.now(),
      outcome: 'sending'
    })
    document.state = 'sending'
    document.error = undefined
    this.save(sessionId, revision, document)
    return attemptId
  }

  confirmSend(sessionId: string, resumeToken: string, assistantMessageId?: string): void {
    const current = this.get(sessionId)
    if (!current || !['sending', 'failed'].includes(current.document.state)) return
    const audit = current.document.audits.at(-1)
    if (!audit || audit.outcome === 'sent') return
    if (assistantMessageId && audit.assistantMessageId !== assistantMessageId) return
    audit.outcome = 'sent'
    audit.resumeToken = resumeToken
    audit.confirmedAt = Date.now()
    current.document.state = 'sent'
    current.document.error = undefined
    this.save(sessionId, current.revision, current.document)
  }

  reconcileReceipt(sessionId: string): void {
    const current = this.get(sessionId)
    const audit = current?.document.audits.at(-1)
    if (!audit || audit.outcome === 'sent') return
    const message = application
      .get('DbService')
      .getDb()
      .select()
      .from(agentSessionMessageTable)
      .where(
        and(
          eq(agentSessionMessageTable.sessionId, sessionId),
          eq(agentSessionMessageTable.id, audit.assistantMessageId)
        )
      )
      .get()
    if (message?.status === 'success' && message.runtimeResumeToken)
      this.confirmSend(sessionId, message.runtimeResumeToken, message.id)
  }

  fail(sessionId: string, detail: ForkContextError): void {
    const current = this.get(sessionId)
    if (!current || current.document.state === 'sent') return
    if (current.document.error?.category === 'needs_reconciliation') return
    const uncertain = current.document.state === 'sending'
    current.document.state = detail.category === 'cancelled' && !uncertain ? 'cancelled' : 'failed'
    current.document.error = uncertain ? { code: 'native_uncertain', category: 'needs_reconciliation' } : detail
    if (uncertain) {
      const audit = current.document.audits.at(-1)
      if (audit) audit.outcome = 'uncertain'
    }
    this.save(sessionId, current.revision, current.document)
  }
}

export const agentSessionForkContextService = new AgentSessionForkContextService()
