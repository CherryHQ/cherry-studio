import type { Disposable } from '@main/core/lifecycle'
import type { BrowserCursorArrival, BrowserCursorIdentity, BrowserCursorState } from '@shared/types/browserCursor'

import type { CommandOptions } from './browserUse'
import { BrowserSessionError } from './session/BrowserSessionError'

export interface BrowserPointerTarget {
  x: number
  y: number
}

export interface BrowserPointerFeedback {
  move: (point: BrowserPointerTarget, options: CommandOptions) => Promise<boolean>
  update: (point: BrowserPointerTarget) => void
  pressed: () => void
  hide: () => void
}

export interface BrowserActionOptions extends CommandOptions {
  pointer?: BrowserPointerFeedback
}

export class BrowserCursor implements Disposable {
  private sequence = 0
  private presented = false
  private disposed = false
  private position?: Extract<BrowserCursorState, { kind: 'move' | 'pressed' }>
  private pending?: { sequence: number; documentId: string; finish: (error?: unknown) => void }

  constructor(
    private readonly identity: BrowserCursorIdentity,
    private readonly send: (state: BrowserCursorState) => void,
    private readonly isFocused: () => boolean,
    private readonly getScale: () => number
  ) {}

  setPresented(presented: boolean): void {
    this.presented = presented
    if (!presented) this.hide()
  }

  arrive(arrival: BrowserCursorArrival): void {
    if (
      arrival.tabId === this.identity.tabId &&
      arrival.sessionId === this.identity.sessionId &&
      arrival.sequence === this.pending?.sequence &&
      arrival.documentId === this.pending.documentId
    )
      this.pending.finish()
  }

  async move(point: BrowserPointerTarget, documentId: string, options: CommandOptions): Promise<boolean> {
    options.signal?.throwIfAborted()
    if (this.disposed) throw new BrowserSessionError('not_found')
    this.pending?.finish()
    if (!this.presented || !this.isFocused()) {
      this.hide()
      return false
    }
    const duration = Math.min(250, (options.deadline ?? Infinity) - Date.now())
    if (duration <= 0) throw new BrowserSessionError('timeout')
    const sequence = ++this.sequence
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: unknown) => {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        if (this.pending?.sequence === sequence) this.pending = undefined
        if (error) reject(error)
        else resolve()
      }
      const onAbort = () => {
        finish(options.signal?.reason)
        this.hide()
      }
      const timer = setTimeout(() => {
        finish()
        this.hide()
      }, duration)
      timer.unref()
      this.pending = { sequence, documentId, finish }
      options.signal?.addEventListener('abort', onAbort, { once: true })
      this.position = {
        ...this.identity,
        x: point.x,
        y: point.y,
        documentId,
        sequence,
        kind: 'move',
        animate: true,
        scale: this.getScale()
      }
      try {
        this.send(this.position)
      } catch {
        finish()
        this.position = undefined
      }
    })
    options.signal?.throwIfAborted()
    return true
  }

  update(point: BrowserPointerTarget): void {
    if (!this.position || !this.presented || !this.isFocused()) return
    const scale = this.getScale()
    if (point.x === this.position.x && point.y === this.position.y && scale === this.position.scale) return
    this.position = { ...this.position, x: point.x, y: point.y, sequence: ++this.sequence, animate: false, scale }
    this.send(this.position)
  }

  pressed(): void {
    if (!this.position || !this.presented || !this.isFocused()) return
    this.position = { ...this.position, sequence: ++this.sequence, kind: 'pressed', animate: false }
    this.send(this.position)
  }

  hide(error?: unknown): void {
    this.pending?.finish(error)
    if (!this.position) return
    this.position = undefined
    this.send({ ...this.identity, sequence: ++this.sequence, kind: 'hidden' })
  }

  dispose(): void {
    this.disposed = true
    this.hide(new BrowserSessionError('not_found'))
  }
}
