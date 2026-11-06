import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { v7 as uuidv7 } from 'uuid'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { queueImportedHistoryTx } from '@data/services/importedSessionHistory'
import { ensureImportedSessionHistory } from '@main/ai/runtime/pi/importedSessionHistory'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { HistorySource } from '@shared/data/types/conversationImport'
import type {
  ImportCandidate,
  ImportFilterCounts,
  ImportOutcome,
  ImportPreviewItem,
  ImportSelection
} from '@shared/ipc/schemas/conversationImport'

import { claudeCodeAdapter } from './claudeCode'
import { IMPORT_LIMITS, type HistorySourceAdapter, type NormalizedSession, type SessionRef } from './types'

interface Prepared {
  item: ImportPreviewItem
  session?: NormalizedSession
}
interface Scan {
  id: string
  root: string
  adapter: HistorySourceAdapter
  refs: Map<string, SessionRef>
  abort: AbortController
  expiresAt: number
  revision: number
  busy: boolean
  preview?: { id: string; targetAgentId: string; items: Map<string, Prepared>; bytes: number }
}

@Injectable('ConversationImportService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager'])
export class ConversationImportService extends BaseService {
  private readonly scans = new Map<string, Scan>()

  protected onInit(): void {
    this.registerDisposable(application.get('WindowManager').onWindowDestroyed((window) => this.cancel(window.id)))
    this.registerInterval(() => {
      for (const [owner, scan] of this.scans) if (!scan.busy && scan.expiresAt <= Date.now()) this.cancel(owner)
    }, 30_000)
  }
  protected onStop(): void {
    for (const owner of this.scans.keys()) this.cancel(owner)
  }
  cancel(owner: string): void {
    this.scans.get(owner)?.abort.abort()
    this.scans.delete(owner)
  }
  async discover(owner: string, source: HistorySource, requestedRoot?: string) {
    if (source !== 'claude-code') throw new Error('unsupported_source')
    this.cancel(owner)
    const root = await realpath(requestedRoot ?? application.getPath('external.claude.projects'))
    const scan: Scan = {
      id: randomUUID(),
      root,
      adapter: claudeCodeAdapter,
      refs: new Map(),
      abort: new AbortController(),
      expiresAt: Date.now() + IMPORT_LIMITS.previewMs,
      revision: 0,
      busy: true
    }
    this.scans.set(owner, scan)
    const candidates: ImportCandidate[] = []
    const filtered: ImportFilterCounts = { codex_guardian_review: 0, claude_no_user_task: 0 }
    let scanned = 0
    try {
      for await (const reference of scan.adapter.discover(root, scan.abort.signal)) {
        const file = reference.path
        if (++scanned > 10_000) throw new Error('scan_limit')
        const canonical = await realpath(file)
        if (!within(root, canonical)) throw new Error('source_changed')
        if (reference.filteredReason) {
          filtered[reference.filteredReason]++
          continue
        }
        const ref = randomUUID()
        scan.refs.set(ref, { ...reference, path: canonical })
        candidates.push({ ref, title: reference.title ?? path.basename(file, '.jsonl'), sourcePath: canonical })
      }
      return { scanId: scan.id, root, candidates, filtered }
    } catch (error) {
      if (this.scans.get(owner) === scan) this.cancel(owner)
      throw error
    } finally {
      scan.busy = false
    }
  }
  private requireScan(owner: string): Scan {
    const scan = this.scans.get(owner)
    if (!scan || scan.expiresAt <= Date.now()) {
      this.cancel(owner)
      throw new Error('preview_expired')
    }
    scan.abort.signal.throwIfAborted()
    return scan
  }
  async preview(owner: string, scanId: string, targetAgentId: string, selections: ImportSelection[]) {
    const scan = this.requireScan(owner)
    if (scan.id !== scanId || scan.busy) throw new Error('invalid_preview')
    this.target(targetAgentId)
    if (
      !selections.length ||
      selections.length > IMPORT_LIMITS.sessions ||
      new Set(selections.map((s) => s.ref)).size !== selections.length
    )
      throw new Error('batch_limit')
    scan.preview = undefined
    const revision = ++scan.revision
    scan.busy = true
    const items = new Map<string, Prepared>()
    let inputBytes = 0
    let normalizedBytes = 0
    try {
      for (const selection of selections) {
        scan.abort.signal.throwIfAborted()
        const reference = scan.refs.get(selection.ref)
        if (!reference) throw new Error('invalid_reference')
        const file = reference.path
        const base: ImportPreviewItem = {
          ref: selection.ref,
          title: reference.title || path.basename(file, '.jsonl'),
          sourcePath: file,
          originalSessionId: reference.originalSessionId ?? '',
          branches: [],
          messageCount: 0,
          models: [],
          diagnostics: [],
          skippedRecords: 0,
          downgradedParts: 0
        }
        try {
          if ((await realpath(file)) !== file) throw new Error('source_changed')
          const session = await scan.adapter.read(reference, scan.abort.signal, selection.branchId)
          inputBytes += session.inputBytes
          normalizedBytes += Buffer.byteLength(JSON.stringify(session))
          if (inputBytes > IMPORT_LIMITS.batch || normalizedBytes > IMPORT_LIMITS.batch) throw new Error('batch_limit')
          const range = timeRange(session)
          const item: ImportPreviewItem = {
            ...base,
            filteredReason: session.filteredReason,
            title: session.title,
            originalSessionId: session.originalSessionId,
            branches: session.branches,
            branchId: session.selectedBranchId,
            originalDirectory: session.workingDirectory,
            messageCount: session.messages.length,
            models: [
              ...new Set(session.messages.flatMap((m) => (m.messageSnapshot ? [m.messageSnapshot.model.name] : [])))
            ],
            startedAt: session.messages[0] ? new Date(range.start).toISOString() : undefined,
            endedAt: session.messages.at(-1) ? new Date(range.end).toISOString() : undefined,
            diagnostics: [...session.diagnostics],
            skippedRecords: session.skippedRecords,
            downgradedParts: session.downgradedParts
          }
          if (session.filteredReason) {
            items.set(selection.ref, { item, session })
            continue
          }
          const ambiguous = item.diagnostics.some((d) => d.code === 'directory_required')
          if (selection.directory && (session.workingDirectory || ambiguous))
            item.diagnostics = item.diagnostics.filter((d) => d.code !== 'directory_required')
          const directory =
            session.workingDirectory || ambiguous ? (selection.directory ?? session.workingDirectory) : undefined
          if (directory) {
            try {
              item.directory = await this.validateDirectory(directory)
            } catch {
              item.diagnostics.push({ code: 'directory_required', severity: 'error', path: directory })
            }
          }
          if (session.messages.some((m) => m.timestamp > Date.now()))
            item.diagnostics.push({ code: 'clock_skew', severity: 'error', path: file })
          const existing = agentSessionService.findImportedTx(
            application.get('DbService').getDb(),
            session.source,
            session.originalSessionId
          )
          if (existing) {
            item.existing = { sessionId: existing.id, agentId: existing.agentId, inTrash: existing.deletedAt !== null }
            item.diagnostics = []
          }
          items.set(selection.ref, { item, session })
        } catch (error) {
          if (scan.abort.signal.aborted || code(error) === 'batch_limit') throw error
          base.diagnostics.push({ code: code(error), severity: 'error', path: file })
          items.set(selection.ref, { item: base })
        }
      }
      if (this.scans.get(owner) !== scan || revision !== scan.revision) throw new Error('invalid_preview')
      const retained = [...this.scans.values()].reduce((sum, value) => sum + (value.preview?.bytes ?? 0), 0)
      if (retained + normalizedBytes > IMPORT_LIMITS.batch) throw new Error('batch_limit')
      scan.expiresAt = Date.now() + IMPORT_LIMITS.previewMs
      scan.preview = { id: randomUUID(), targetAgentId, items, bytes: normalizedBytes }
      return {
        previewId: scan.preview.id,
        expiresAt: scan.expiresAt,
        items: [...items.values()].map((value) => value.item)
      }
    } finally {
      scan.busy = false
    }
  }
  async commit(owner: string, previewId: string, refs: string[]): Promise<ImportOutcome[]> {
    const scan = this.requireScan(owner)
    const preview = scan.preview
    if (
      !preview ||
      preview.id !== previewId ||
      scan.busy ||
      !refs.length ||
      new Set(refs).size !== refs.length ||
      refs.some((ref) => !preview.items.has(ref))
    )
      throw new Error('invalid_preview')
    scan.busy = true
    // Consume once; concurrent or repeated confirmation cannot reuse a snapshot.
    scan.preview = undefined
    const outcomes: ImportOutcome[] = []
    let stopped = false
    try {
      for (const ref of refs) {
        await delay(0)
        if (stopped || scan.abort.signal.aborted) {
          outcomes.push({ ref, status: 'unprocessed' })
          continue
        }
        const { item, session } = preview.items.get(ref)!
        if (item.filteredReason) {
          outcomes.push({ ref, status: 'filtered', reason: item.filteredReason })
          continue
        }
        try {
          if (session?.originalSessionId) {
            const existing = application.get('DbService').withWriteTx((tx) => {
              agentService.getImportTargetTx(tx, preview.targetAgentId)
              return agentSessionService.findImportedTx(tx, session.source, session.originalSessionId)
            })
            if (existing) {
              outcomes.push({ ref, status: 'existing', sessionId: existing.id, agentId: existing.agentId })
              continue
            }
          }
          if (!session || item.diagnostics.some((d) => d.severity === 'error')) {
            outcomes.push({ ref, status: 'failed', reason: 'preview_blocked' })
            continue
          }
          this.target(preview.targetAgentId)
          if ((await realpath(item.sourcePath)) !== item.sourcePath) throw new Error('source_changed')
          const fresh = await scan.adapter.read(scan.refs.get(ref)!, scan.abort.signal, item.branchId)
          if (fresh.sourceFingerprint !== session.sourceFingerprint) throw new Error('source_changed')
          if (fresh.filteredReason) {
            outcomes.push({ ref, status: 'filtered', reason: fresh.filteredReason })
            continue
          }
          if (item.directory && (await this.validateDirectory(item.directory)) !== item.directory)
            throw new Error('directory_required')
          const range = timeRange(session)
          const end = range.end
          if (end > Date.now()) throw new Error('clock_skew')
          if (end === Date.now()) await delay(1, undefined, { signal: scan.abort.signal })
          scan.abort.signal.throwIfAborted()
          const nativeSessionId = randomUUID()
          const result = application.get('DbService').withWriteTx((tx) => {
            const agent = agentService.getImportTargetTx(tx, preview.targetAgentId)
            if (end >= Date.now()) throw new Error('clock_skew')
            const existing = agentSessionService.findImportedTx(tx, session.source, session.originalSessionId)
            if (existing) {
              return { sessionId: existing.id, agentId: existing.agentId, existing: true }
            }
            const sessionId = randomUUID()
            const workspace = item.directory
              ? {
                  type: 'user' as const,
                  workspaceId: agentWorkspaceService.findOrCreateByPathTx(tx, item.directory).id
                }
              : { type: 'system' as const }
            agentSessionService.createTx(
              tx,
              sessionId,
              {
                agentId: agent.id,
                name: session.title.slice(0, 255),
                workspace
              },
              'conversation',
              range.start
            )
            agentSessionService.setImportMetadataTx(
              tx,
              sessionId,
              {
                source: session.source,
                originalSessionId: session.originalSessionId
              },
              end
            )
            agentSessionMessageService.importMessagesTx(
              tx,
              sessionId,
              session.messages.map((message, index) => ({
                id: uuidv7({ msecs: message.timestamp, seq: index }),
                role: message.role,
                data: message.data,
                status: message.status,
                modelId: null,
                messageSnapshot: message.messageSnapshot,
                provenance: message.provenance,
                runtimeResumeToken: nativeSessionId,
                createdAt: message.timestamp,
                updatedAt: message.timestamp
              }))
            )
            queueImportedHistoryTx(tx, sessionId, nativeSessionId, session.messages.length)
            return { sessionId, agentId: agent.id, existing: false }
          })
          if (result.existing) {
            outcomes.push({ ref, status: 'existing', sessionId: result.sessionId, agentId: result.agentId })
            continue
          }
          agentSessionService.notifyReadModelChange([result.sessionId], 'membership')
          notifyDataApiDataChange([{ endpoint: '/agent-workspaces', kind: 'membership' }])
          const outcome: ImportOutcome = {
            ref,
            status: 'imported',
            sessionId: result.sessionId,
            agentId: result.agentId,
            initialization: 'ready'
          }
          try {
            await ensureImportedSessionHistory(result.sessionId)
          } catch {
            outcome.initialization = 'failed'
          }
          outcomes.push(outcome)
        } catch (error) {
          const reason = code(error)
          if (reason === 'target_changed') stopped = true
          outcomes.push({ ref, status: scan.abort.signal.aborted ? 'unprocessed' : 'failed', reason })
        }
      }
      return outcomes
    } finally {
      scan.busy = false
      scan.expiresAt = Date.now() + IMPORT_LIMITS.previewMs
    }
  }
  private target(id: string) {
    return agentService.getImportTargetTx(application.get('DbService').getDb(), id)
  }
  private async validateDirectory(directory: string): Promise<string> {
    if (!path.isAbsolute(directory)) throw new Error('directory_required')
    const canonical = await realpath(directory)
    if (!(await stat(canonical)).isDirectory()) throw new Error('directory_required')
    await access(canonical, constants.R_OK | constants.X_OK)
    return canonical
  }
}
function within(root: string, file: string): boolean {
  const relative = path.relative(root, file)
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}
function code(error: unknown): string {
  return error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'read_failed'
}

function timeRange(session: NormalizedSession) {
  return session.messages.reduce(
    (range, message) => ({
      start: Math.min(range.start, message.timestamp),
      end: Math.max(range.end, message.timestamp)
    }),
    { start: Infinity, end: -Infinity }
  )
}
