import { cacheService } from '@data/CacheService'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { PdfTranslationProgressStage, PdfTranslationStage } from '@shared/ipc/schemas/translate'
import type { AbsoluteFilePath } from '@shared/types/file'

export type TranslateSessionRuntimeStatus = 'completed' | 'error' | 'idle' | 'running'

export interface TranslateSessionRuntimeSnapshot {
  isTranslating: boolean
  status: TranslateSessionRuntimeStatus
}

export interface PdfTranslationSessionFile {
  name: string
  path: AbsoluteFilePath
}

export interface PdfTranslationSessionOutput {
  outputPath: AbsoluteFilePath
  fileName: string
}

export type PdfTranslationSessionPhase = PdfTranslationStage | 'idle' | 'success' | 'error'

export interface PdfTranslationSessionProgress {
  stage: PdfTranslationProgressStage
  stageProgress: number | null
  overallProgress: number
}

export interface PdfTranslationSessionSnapshot {
  activeJobId: string | null
  error: Error | null
  file: PdfTranslationSessionFile | null
  output: PdfTranslationSessionOutput | null
  phase: PdfTranslationSessionPhase
  progress: PdfTranslationSessionProgress | null
  targetLanguage: TranslateLangCode | null
}

interface TranslateSessionRuntime {
  activeAbortKey: string | null
  controller: AbortController | null
  listeners: Set<() => void>
  pdfCancel: (() => void) | null
  pdfListeners: Set<() => void>
  pdfSnapshot: PdfTranslationSessionSnapshot
  snapshot: TranslateSessionRuntimeSnapshot
}

export const IDLE_TRANSLATE_SESSION_SNAPSHOT: TranslateSessionRuntimeSnapshot = {
  isTranslating: false,
  status: 'idle'
}

export const IDLE_PDF_TRANSLATION_SESSION_SNAPSHOT: PdfTranslationSessionSnapshot = {
  activeJobId: null,
  error: null,
  file: null,
  output: null,
  phase: 'idle',
  progress: null,
  targetLanguage: null
}

const TRANSLATE_STATUS_PRIORITY: Record<TranslateSessionRuntimeStatus, number> = {
  idle: 0,
  completed: 1,
  running: 2,
  error: 3
}

const RELEASE_RETRY_DELAY_MS = 50

function releaseSessionCache(sessionId: string): boolean {
  const inputReleased = cacheService.delete(`translate.session.input.${sessionId}` as const)
  const outputReleased = cacheService.delete(`translate.session.output.${sessionId}` as const)
  const detectingReleased = cacheService.delete(`translate.session.detecting.${sessionId}` as const)
  return inputReleased && outputReleased && detectingReleased
}

export class TranslateSessionManager {
  private readonly referencedSessionIds = new Set<string>()
  private readonly releaseTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly sessions = new Map<string, TranslateSessionRuntime>()
  private readonly workspaceListeners = new Set<() => void>()
  private workspaceStatus: TranslateSessionRuntimeStatus = 'idle'

  private getRuntime(sessionId: string): TranslateSessionRuntime {
    let runtime = this.sessions.get(sessionId)
    if (!runtime) {
      runtime = {
        activeAbortKey: null,
        controller: null,
        listeners: new Set(),
        pdfCancel: null,
        pdfListeners: new Set(),
        pdfSnapshot: IDLE_PDF_TRANSLATION_SESSION_SNAPSHOT,
        snapshot: IDLE_TRANSLATE_SESSION_SNAPSHOT
      }
      this.sessions.set(sessionId, runtime)
    }
    return runtime
  }

  getSessionIds(): string[] {
    return [...this.sessions.keys()]
  }

  getSessionSnapshot(sessionId: string): TranslateSessionRuntimeSnapshot {
    return this.getRuntime(sessionId).snapshot
  }

  subscribeSession(sessionId: string, listener: () => void): () => void {
    const runtime = this.getRuntime(sessionId)
    runtime.listeners.add(listener)
    return () => {
      runtime.listeners.delete(listener)
      this.reconcileRelease(sessionId)
    }
  }

  getPdfSnapshot(sessionId: string): PdfTranslationSessionSnapshot {
    return this.getRuntime(sessionId).pdfSnapshot
  }

  subscribePdfSession(sessionId: string, listener: () => void): () => void {
    const runtime = this.getRuntime(sessionId)
    runtime.pdfListeners.add(listener)
    return () => {
      runtime.pdfListeners.delete(listener)
      this.reconcileRelease(sessionId)
    }
  }

  getWorkspaceStatus(): TranslateSessionRuntimeStatus {
    return this.workspaceStatus
  }

  subscribeWorkspace(listener: () => void): () => void {
    this.workspaceListeners.add(listener)
    return () => this.workspaceListeners.delete(listener)
  }

  setReferencedSessionIds(sessionIds: ReadonlySet<string>): void {
    this.referencedSessionIds.clear()
    for (const sessionId of sessionIds) this.referencedSessionIds.add(sessionId)
    for (const sessionId of this.sessions.keys()) this.reconcileRelease(sessionId)
  }

  beginText(sessionId: string, abortKey: string, controller: AbortController): void {
    const runtime = this.getRuntime(sessionId)
    runtime.controller?.abort()
    runtime.activeAbortKey = abortKey
    runtime.controller = controller
    this.updateSessionSnapshot(sessionId, runtime, { isTranslating: true, status: 'running' })
  }

  isTextActive(sessionId: string, abortKey: string): boolean {
    return this.getRuntime(sessionId).activeAbortKey === abortKey
  }

  setTextStatus(sessionId: string, abortKey: string, status: 'completed' | 'error'): boolean {
    const runtime = this.getRuntime(sessionId)
    if (runtime.activeAbortKey !== abortKey) return false
    this.updateSessionSnapshot(sessionId, runtime, { isTranslating: true, status })
    return true
  }

  finishText(sessionId: string, abortKey: string): void {
    const runtime = this.getRuntime(sessionId)
    if (runtime.activeAbortKey !== abortKey) return
    runtime.activeAbortKey = null
    runtime.controller = null
    this.updateSessionSnapshot(sessionId, runtime, {
      isTranslating: false,
      status: runtime.snapshot.status
    })
  }

  setStatus(sessionId: string, status: TranslateSessionRuntimeStatus): void {
    const runtime = this.getRuntime(sessionId)
    this.updateSessionSnapshot(sessionId, runtime, { isTranslating: status === 'running', status })
  }

  preparePdf(
    sessionId: string,
    file: PdfTranslationSessionFile,
    restoredOutput: PdfTranslationSessionOutput | null = null
  ): void {
    const runtime = this.getRuntime(sessionId)
    if (runtime.pdfSnapshot.activeJobId) return
    if (!restoredOutput && runtime.pdfSnapshot.file?.path === file.path) return
    this.updatePdfSnapshot(sessionId, runtime, {
      ...IDLE_PDF_TRANSLATION_SESSION_SNAPSHOT,
      file,
      output: restoredOutput,
      phase: restoredOutput ? 'success' : 'idle'
    })
  }

  beginPdf(
    sessionId: string,
    jobId: string,
    file: PdfTranslationSessionFile,
    targetLanguage: TranslateLangCode,
    cancel: () => void
  ): void {
    const runtime = this.getRuntime(sessionId)
    if (runtime.pdfSnapshot.activeJobId) return
    runtime.pdfCancel = cancel
    this.updatePdfSnapshot(sessionId, runtime, {
      activeJobId: jobId,
      error: null,
      file,
      output: null,
      phase: 'preparing',
      progress: null,
      targetLanguage
    })
    this.updateSessionSnapshot(sessionId, runtime, { isTranslating: true, status: 'running' })
  }

  updatePdfStage(sessionId: string, jobId: string, phase: PdfTranslationStage): void {
    const runtime = this.getRuntime(sessionId)
    if (runtime.pdfSnapshot.activeJobId !== jobId) return
    this.updatePdfSnapshot(sessionId, runtime, { ...runtime.pdfSnapshot, phase })
  }

  updatePdfProgress(sessionId: string, jobId: string, progress: PdfTranslationSessionProgress): void {
    const runtime = this.getRuntime(sessionId)
    if (runtime.pdfSnapshot.activeJobId !== jobId) return
    if (runtime.pdfSnapshot.progress && progress.overallProgress < runtime.pdfSnapshot.progress.overallProgress) return
    this.updatePdfSnapshot(sessionId, runtime, { ...runtime.pdfSnapshot, phase: 'translating', progress })
  }

  completePdf(sessionId: string, jobId: string, output: PdfTranslationSessionOutput): boolean {
    const runtime = this.getRuntime(sessionId)
    if (runtime.pdfSnapshot.activeJobId !== jobId) return false
    runtime.pdfCancel = null
    this.updatePdfSnapshot(sessionId, runtime, {
      ...runtime.pdfSnapshot,
      activeJobId: null,
      output,
      phase: 'success',
      progress: null
    })
    this.updateSessionSnapshot(sessionId, runtime, { isTranslating: false, status: 'completed' })
    return true
  }

  failPdf(sessionId: string, jobId: string, error: Error): boolean {
    const runtime = this.getRuntime(sessionId)
    if (runtime.pdfSnapshot.activeJobId !== jobId) return false
    runtime.pdfCancel = null
    this.updatePdfSnapshot(sessionId, runtime, {
      ...runtime.pdfSnapshot,
      activeJobId: null,
      error,
      phase: 'error',
      progress: null
    })
    this.updateSessionSnapshot(sessionId, runtime, { isTranslating: false, status: 'error' })
    return true
  }

  cancel(sessionId: string): boolean {
    const runtime = this.getRuntime(sessionId)
    if (runtime.activeAbortKey) {
      runtime.activeAbortKey = null
      runtime.controller?.abort()
      runtime.controller = null
      this.updateSessionSnapshot(sessionId, runtime, IDLE_TRANSLATE_SESSION_SNAPSHOT)
      return true
    }

    if (!runtime.pdfSnapshot.activeJobId) return false
    const cancelPdf = runtime.pdfCancel
    runtime.pdfCancel = null
    this.updatePdfSnapshot(sessionId, runtime, {
      ...runtime.pdfSnapshot,
      activeJobId: null,
      phase: 'idle',
      progress: null
    })
    this.updateSessionSnapshot(sessionId, runtime, IDLE_TRANSLATE_SESSION_SNAPSHOT)
    cancelPdf?.()
    return true
  }

  resetPdf(sessionId: string): void {
    this.cancel(sessionId)
    const runtime = this.getRuntime(sessionId)
    this.updatePdfSnapshot(sessionId, runtime, IDLE_PDF_TRANSLATION_SESSION_SNAPSHOT)
  }

  markWorkspaceSeen(): void {
    for (const [sessionId, runtime] of this.sessions) {
      if (runtime.snapshot.isTranslating || runtime.snapshot.status === 'idle') continue
      this.updateSessionSnapshot(sessionId, runtime, IDLE_TRANSLATE_SESSION_SNAPSHOT)
    }
  }

  clear(): void {
    for (const timer of this.releaseTimers.values()) clearTimeout(timer)
    this.releaseTimers.clear()
    for (const runtime of this.sessions.values()) {
      runtime.controller?.abort()
      runtime.pdfCancel?.()
    }
    this.sessions.clear()
    this.referencedSessionIds.clear()
    this.refreshWorkspaceStatus()
  }

  private updateSessionSnapshot(
    sessionId: string,
    runtime: TranslateSessionRuntime,
    snapshot: TranslateSessionRuntimeSnapshot
  ): void {
    if (runtime.snapshot.isTranslating === snapshot.isTranslating && runtime.snapshot.status === snapshot.status) return
    runtime.snapshot = snapshot
    for (const listener of runtime.listeners) listener()
    this.refreshWorkspaceStatus()
    this.reconcileRelease(sessionId)
  }

  private updatePdfSnapshot(
    sessionId: string,
    runtime: TranslateSessionRuntime,
    snapshot: PdfTranslationSessionSnapshot
  ): void {
    runtime.pdfSnapshot = snapshot
    for (const listener of runtime.pdfListeners) listener()
    this.reconcileRelease(sessionId)
  }

  private refreshWorkspaceStatus(): void {
    let nextStatus: TranslateSessionRuntimeStatus = 'idle'
    for (const runtime of this.sessions.values()) {
      if (TRANSLATE_STATUS_PRIORITY[runtime.snapshot.status] > TRANSLATE_STATUS_PRIORITY[nextStatus]) {
        nextStatus = runtime.snapshot.status
      }
    }
    if (nextStatus === this.workspaceStatus) return
    this.workspaceStatus = nextStatus
    for (const listener of this.workspaceListeners) listener()
  }

  private reconcileRelease(sessionId: string): void {
    const existingTimer = this.releaseTimers.get(sessionId)
    const runtime = this.sessions.get(sessionId)
    const shouldRetain =
      this.referencedSessionIds.has(sessionId) ||
      !runtime ||
      runtime.snapshot.isTranslating ||
      runtime.pdfSnapshot.activeJobId !== null ||
      runtime.listeners.size > 0 ||
      runtime.pdfListeners.size > 0

    if (shouldRetain) {
      if (existingTimer) clearTimeout(existingTimer)
      this.releaseTimers.delete(sessionId)
      return
    }
    if (existingTimer) return

    const timer = setTimeout(() => {
      this.releaseTimers.delete(sessionId)
      const current = this.sessions.get(sessionId)
      if (
        this.referencedSessionIds.has(sessionId) ||
        !current ||
        current.snapshot.isTranslating ||
        current.pdfSnapshot.activeJobId !== null ||
        current.listeners.size > 0 ||
        current.pdfListeners.size > 0
      ) {
        return
      }
      if (!releaseSessionCache(sessionId)) {
        const retryTimer = setTimeout(() => {
          this.releaseTimers.delete(sessionId)
          this.reconcileRelease(sessionId)
        }, RELEASE_RETRY_DELAY_MS)
        this.releaseTimers.set(sessionId, retryTimer)
        return
      }
      this.sessions.delete(sessionId)
      this.refreshWorkspaceStatus()
    }, 0)
    this.releaseTimers.set(sessionId, timer)
  }
}

export const translateSessionManager = new TranslateSessionManager()
