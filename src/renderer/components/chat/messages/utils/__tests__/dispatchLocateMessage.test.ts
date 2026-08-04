import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageListRuntime } from '../../types'
import { dispatchLocateMessage } from '../dispatchLocateMessage'

function createRuntime(): MessageListRuntime {
  return {
    scrollToBottom: vi.fn(),
    locateMessage: vi.fn(),
    scrollToRange: vi.fn(),
    copyTopicImage: vi.fn(),
    exportTopicImage: vi.fn()
  }
}

function installQueuedAnimationFrame(): { restore(): void; tick(frames?: number): void } {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  let rafId = 0
  let rafQueue = new Map<number, () => void>()

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const id = ++rafId
    rafQueue.set(id, () => callback(0))
    return id
  }) as typeof requestAnimationFrame

  return {
    restore() {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame
    },
    tick(frames = 1) {
      for (let i = 0; i < frames; i++) {
        if (rafQueue.size === 0) return
        const batch = Array.from(rafQueue.values())
        rafQueue = new Map()
        batch.forEach((fn) => fn())
      }
    }
  }
}

// Emittery delivers listeners asynchronously — flush before asserting.
const flushEmit = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('dispatchLocateMessage', () => {
  let raf: ReturnType<typeof installQueuedAnimationFrame>
  const unsubscribes: Array<() => void> = []

  const subscribe = (messageId: string, listener: (highlight?: boolean) => void) => {
    unsubscribes.push(EventEmitter.on(EVENT_NAMES.LOCATE_MESSAGE + ':' + messageId, listener))
  }

  beforeEach(() => {
    raf = installQueuedAnimationFrame()
  })

  afterEach(() => {
    unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe())
    raf.restore()
  })

  it('scrolls first and delivers once the virtualized subscriber mounts', async () => {
    const runtime = createRuntime()
    const listener = vi.fn()

    dispatchLocateMessage(runtime, 'message-late', true)
    expect(runtime.locateMessage).toHaveBeenCalledWith('message-late')

    // The smooth navigation is still flying — the target group is unmounted
    // and there is nothing to deliver to yet.
    raf.tick(20)
    await flushEmit()
    expect(listener).not.toHaveBeenCalled()

    subscribe('message-late', listener)
    raf.tick()
    await flushEmit()
    expect(listener).toHaveBeenCalledWith(true)

    // One-shot: later frames do not re-deliver.
    raf.tick(10)
    await flushEmit()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
