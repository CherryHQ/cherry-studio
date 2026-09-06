import { setTimeout as delay } from 'node:timers/promises'

import { loggerService } from '@logger'
import { type Disposable, Emitter } from '@main/core/lifecycle'
import type { WebviewAnnotation } from '@shared/types/webviewAnnotation'
import { Mutex } from 'async-mutex'
import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping'
import type { DownloadItem } from 'electron'

import {
  type BrowserDialog,
  type BrowserRef,
  type BrowserSnapshot,
  type CommandOptions,
  type SessionOwnership,
  type SnapshotOptions,
  snapshotOptionsSchema,
  type TabRetention
} from '../browserUse'
import type { AccessibilityCaptureBudget } from '../snapshot/accessibilityTypes'
import { buildSnapshotTree } from '../snapshot/buildSnapshotTree'
import { captureSnapshot } from '../snapshot/captureSnapshot'
import { createAccessibilityContext, describeElement } from '../snapshot/describeElement'
import { diffSnapshot } from '../snapshot/diffSnapshot'
import { sanitizeSnapshotUrl, serializeSnapshot, type SnapshotRevision } from '../snapshot/serializeSnapshot'
import { BrowserSessionError } from './BrowserSessionError'
import { cdpAllowList, type CdpCommandArgs, type CdpMethod } from './cdpAllowList'

const logger = loggerService.withContext('GuestSession')

export class GuestSession implements Disposable {
  readonly ownership: SessionOwnership['ownership']
  retention: TabRetention = 'temporary'
  lastActive = Date.now()
  private currentDocumentId = ''
  private currentMainFrameId = ''
  pendingDialog?: BrowserDialog
  private attached = false
  private disposed = false
  private attaching?: Promise<void>
  private epoch = 0
  private nextRef = 1
  private readonly refs = new Map<BrowserRef, number>()
  private readonly nodeRefs = new Map<number, BrowserRef>()
  private readonly pending = new Set<(error: Error) => void>()
  private dialogTimer?: ReturnType<typeof setTimeout>
  private revision?: SnapshotRevision
  private readonly snapshotMutex = new Mutex(new BrowserSessionError('debugger_unavailable'))
  private operations = 0
  private readonly actionMutex = new Mutex(new BrowserSessionError('debugger_unavailable'))
  private readonly events = new Emitter<{ method: string; params: Record<string, any> }>()
  readonly onEvent = this.events.event
  private readonly downloadItems = new Map<DownloadItem, () => void>()
  private readonly downloadUpdates = new Map<DownloadItem, { filename: string; state: string }>()
  private dismissedDialog?: BrowserDialog

  constructor(
    readonly guest: Electron.WebContents,
    ownership: SessionOwnership['ownership']
  ) {
    this.ownership = ownership
    guest.debugger.on('message', this.onMessage)
    guest.debugger.on('detach', this.onDetach)
    guest.once('destroyed', this.onDestroyed)
    if (ownership === 'managed') guest.session.on('will-download', this.onDownload)
  }

  get documentId() {
    return this.currentDocumentId
  }

  get mainFrameId() {
    return this.currentMainFrameId
  }

  get busy() {
    return this.operations > 0 || this.pending.size > 0 || this.downloadItems.size > 0
  }

  isAvailable(): boolean {
    return (
      !this.disposed &&
      !this.guest.isDestroyed() &&
      !this.guest.isDevToolsOpened() &&
      this.attached &&
      this.guest.debugger.isAttached()
    )
  }

  private invalidateDocument() {
    this.epoch++
    this.refs.clear()
    this.nodeRefs.clear()
    this.revision = undefined
  }

  private clearDialog() {
    if (this.dialogTimer) clearTimeout(this.dialogTimer)
    this.dialogTimer = undefined
    this.pendingDialog = undefined
  }

  private rejectPending(error: Error) {
    for (const reject of [...this.pending]) reject(error)
  }

  private readonly onMessage = (_event: Electron.Event, method: string, params: Record<string, any>) => {
    if (method === 'Page.frameNavigated' && !params.frame.parentId) {
      this.currentMainFrameId = params.frame.id
      this.currentDocumentId = params.frame.loaderId
      this.invalidateDocument()
      this.clearDialog()
    } else if (method === 'Page.javascriptDialogOpening') {
      this.pendingDialog = { type: params.type, message: params.message }
      this.rejectPending(new BrowserSessionError('dialog_open', this.pendingDialog))
      if (this.ownership === 'managed') {
        if (this.dialogTimer) clearTimeout(this.dialogTimer)
        this.dialogTimer = setTimeout(() => {
          const dialog = this.pendingDialog
          void this.send('Page.handleJavaScriptDialog', { accept: false })
            .then(() => {
              this.dismissedDialog = dialog
            })
            .catch((error) => logger.debug('Failed to dismiss browser dialog', error))
        }, 60_000)
        this.dialogTimer.unref()
      }
    } else if (method === 'Page.javascriptDialogClosed') this.clearDialog()
    this.events.fire({ method, params })
  }

  private readonly onDetach = () => {
    this.attached = false
    this.invalidateDocument()
    this.clearDialog()
    this.rejectPending(new BrowserSessionError('debugger_unavailable'))
  }

  private readonly onDestroyed = () => this.dispose()

  private wait<T>(operation: Promise<T>, options: CommandOptions): Promise<T> {
    const deadline = options.deadline ?? Date.now() + 5_000
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        if (timer) clearTimeout(timer)
        options.signal?.removeEventListener('abort', abort)
        this.pending.delete(fail)
      }
      const fail = (error: Error) => {
        cleanup()
        reject(error)
      }
      const abort = () => fail(options.signal!.reason)
      this.pending.add(fail)
      const timer = setTimeout(() => fail(new BrowserSessionError('timeout')), Math.max(0, deadline - Date.now()))
      options.signal?.addEventListener('abort', abort, { once: true })
      operation.then((value) => {
        cleanup()
        resolve(value)
      }, fail)
      if (options.signal?.aborted) abort()
    })
  }

  private async ensureAttached(): Promise<void> {
    if (this.disposed || this.guest.isDestroyed() || this.guest.isDevToolsOpened())
      throw new BrowserSessionError('debugger_unavailable')
    if (this.attaching) return this.attaching
    if (this.isAvailable()) return
    if (this.guest.debugger.isAttached()) throw new BrowserSessionError('debugger_unavailable')
    try {
      this.guest.debugger.attach('1.3')
      this.attached = true
    } catch {
      throw new BrowserSessionError('debugger_unavailable')
    }
    const epoch = this.epoch
    const init = async () => {
      for (const method of [
        'Page.enable',
        'Runtime.enable',
        'DOM.enable',
        'Accessibility.enable',
        ...(this.ownership === 'managed' ? (['Network.enable'] as const) : [])
      ] as const) {
        if (!this.isAvailable()) throw new BrowserSessionError('debugger_unavailable')
        await this.wait(this.dispatch(method, undefined), {})
      }
      const result = await this.wait(this.dispatch('Page.getFrameTree', undefined), {})
      if (!this.isAvailable()) throw new BrowserSessionError('debugger_unavailable')
      if (this.epoch === epoch) {
        this.currentMainFrameId = result.frameTree.frame.id
        this.currentDocumentId = result.frameTree.frame.loaderId ?? this.mainFrameId
      }
    }
    this.attaching = init()
    try {
      await this.attaching
    } catch (error) {
      this.rejectPending(error instanceof Error ? error : new BrowserSessionError('debugger_unavailable'))
      this.detach()
      throw error
    } finally {
      this.attaching = undefined
    }
  }

  private dispatch<M extends CdpMethod>(
    method: M,
    params: ProtocolMapping.Commands[NoInfer<M>]['paramsType'][0]
  ): Promise<ProtocolMapping.Commands[M]['returnType']> {
    return this.guest.debugger.sendCommand(method, params)
  }

  async send<M extends CdpMethod>(
    method: M,
    ...[params, options = {}]: CdpCommandArgs<NoInfer<M>>
  ): Promise<ProtocolMapping.Commands[M]['returnType']> {
    if (!cdpAllowList.has(method)) throw new BrowserSessionError('not_allowed')
    options.signal?.throwIfAborted()
    if (options.deadline !== undefined && options.deadline <= Date.now()) throw new BrowserSessionError('timeout')
    if (this.pendingDialog && method !== 'Page.handleJavaScriptDialog')
      throw new BrowserSessionError('dialog_open', this.pendingDialog)
    this.lastActive = Date.now()
    this.operations++
    try {
      await this.wait(this.ensureAttached(), options)
      options.signal?.throwIfAborted()
      if (!this.isAvailable()) throw new BrowserSessionError('debugger_unavailable')
      if (this.pendingDialog && method !== 'Page.handleJavaScriptDialog')
        throw new BrowserSessionError('dialog_open', this.pendingDialog)
      const result = await this.wait(this.dispatch(method, params), options)
      if (method === 'Page.handleJavaScriptDialog') this.clearDialog()
      return result
    } finally {
      this.operations--
      this.lastActive = Date.now()
    }
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new BrowserSessionError('debugger_unavailable')
    this.operations++
    try {
      return await this.actionMutex.runExclusive(() => {
        if (this.disposed) throw new BrowserSessionError('debugger_unavailable')
        return operation()
      })
    } finally {
      this.operations--
      this.lastActive = Date.now()
    }
  }

  async pause(ms: number, options: CommandOptions = {}): Promise<void> {
    if (this.disposed) throw new BrowserSessionError('debugger_unavailable')
    if (this.pendingDialog) throw new BrowserSessionError('dialog_open', this.pendingDialog)
    const controller = new AbortController()
    try {
      await this.wait(delay(ms, undefined, { signal: controller.signal }), options)
      if (this.disposed) throw new BrowserSessionError('debugger_unavailable')
    } finally {
      controller.abort()
    }
  }

  takeEvents() {
    const downloads = [...this.downloadUpdates.values()]
    this.downloadUpdates.clear()
    const dismissedDialog = this.dismissedDialog
    this.dismissedDialog = undefined
    return { ...(downloads.length ? { downloads } : {}), ...(dismissedDialog ? { dismissedDialog } : {}) }
  }

  private readonly onDownload = (_event: Electron.Event, item: DownloadItem, guest: Electron.WebContents) => {
    if (guest !== this.guest) return
    const record = (state: string) => {
      this.downloadUpdates.set(item, { filename: item.getFilename(), state })
      if (this.downloadUpdates.size > 200) this.downloadUpdates.delete(this.downloadUpdates.keys().next().value!)
    }
    const updated = (_event: Electron.Event, state: string) => record(state)
    const done = (_event: Electron.Event, state: string) => {
      record(state)
      cleanup()
      this.downloadItems.delete(item)
    }
    const cleanup = () => {
      item.removeListener('updated', updated)
      item.removeListener('done', done)
    }
    this.downloadItems.set(item, cleanup)
    item.on('updated', updated)
    item.once('done', done)
    record('progressing')
  }

  resolveRef(ref: BrowserRef): number {
    const id = this.refs.get(ref)
    if (id === undefined) throw new BrowserSessionError('stale_ref')
    return id
  }

  private allocateRef = (id: number): BrowserRef => {
    let ref = this.nodeRefs.get(id)
    if (!ref) {
      ref = `e${this.nextRef++}`
      this.nodeRefs.set(id, ref)
      this.refs.set(ref, id)
    }
    return ref
  }

  async snapshot(
    options: SnapshotOptions = {},
    commandOptions: CommandOptions = {}
  ): Promise<{ text: string; snapshot: BrowserSnapshot }> {
    if (this.disposed) throw new BrowserSessionError('debugger_unavailable')
    const opts = snapshotOptionsSchema.parse(options)
    const capture = async () => {
      this.operations++
      try {
        await this.wait(this.ensureAttached(), commandOptions)
        const epoch = this.epoch
        const scope = opts.scope ? this.resolveRef(opts.scope) : undefined
        const raw = await captureSnapshot(this, commandOptions)
        if (epoch !== this.epoch) throw new BrowserSessionError('stale_ref')
        const tree = buildSnapshotTree(raw, this.allocateRef, scope)
        const snapshot: BrowserSnapshot = {
          ...tree,
          documentId: this.documentId,
          url: sanitizeSnapshotUrl(this.guest.getURL()),
          title: this.guest.getTitle(),
          truncated: false
        }
        const maxChars = opts.maxChars ?? 40_000
        const revision = serializeSnapshot(snapshot, maxChars)
        const text = opts.full || opts.scope ? revision.text : diffSnapshot(this.revision, revision, maxChars)
        if (!opts.scope) this.revision = revision
        return { text, snapshot }
      } finally {
        this.operations--
        this.lastActive = Date.now()
      }
    }
    return this.snapshotMutex.runExclusive(capture)
  }

  async describeElement(
    annotation: WebviewAnnotation,
    budget: AccessibilityCaptureBudget,
    options: CommandOptions = {}
  ) {
    options.signal?.throwIfAborted()
    if (options.deadline !== undefined && options.deadline <= Date.now()) return createAccessibilityContext('timeout')
    if (budget.remaining <= 0) return createAccessibilityContext('budget_exceeded')
    this.operations++
    try {
      await this.wait(this.ensureAttached(), options)
      const epoch = this.epoch
      const result = await describeElement(
        this,
        annotation,
        budget,
        options.deadline ?? Date.now() + 5_000,
        options.signal
      )
      if (epoch !== this.epoch) throw new BrowserSessionError('stale_ref')
      return result
    } finally {
      this.operations--
      this.lastActive = Date.now()
    }
  }

  private detach() {
    if (this.attached && this.guest.debugger.isAttached()) {
      try {
        this.guest.debugger.detach()
      } catch (error) {
        logger.debug('Failed to detach browser debugger', { error })
      }
    }
    this.attached = false
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.actionMutex.cancel()
    this.snapshotMutex.cancel()
    this.clearDialog()
    if (this.ownership === 'managed') this.guest.session.removeListener('will-download', this.onDownload)
    for (const cleanup of this.downloadItems.values()) cleanup()
    this.downloadItems.clear()
    this.downloadUpdates.clear()
    this.events.dispose()
    this.rejectPending(new BrowserSessionError('debugger_unavailable'))
    this.detach()
    this.invalidateDocument()
    this.guest.debugger.removeListener('message', this.onMessage)
    this.guest.debugger.removeListener('detach', this.onDetach)
    this.guest.removeListener('destroyed', this.onDestroyed)
  }
}
