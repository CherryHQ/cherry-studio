import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// This suite exercises the real popup store, so opt out of the global services/popup mock.
vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

import { createPopup, popup, POPUP_EXIT_MS, type PopupInjectedProps, popupService } from '../index'

// A trivial popup component — only stored, never rendered here.
const Noop = (_props: { label: string } & PopupInjectedProps<string | null>) => null

let unsubscribe: (() => void) | null = null

/** Subscribe a fake host so popupService.hasHost() is true (like a mounted PopupHost). */
function subscribeHost() {
  const listener = vi.fn()
  unsubscribe = popupService.subscribe(listener)
  return listener
}

/** Settle and flush every remaining entry so the singleton store is empty between tests. */
function flushStore() {
  for (const entry of [...popupService.getSnapshot()]) {
    popupService.settle(entry.instanceId, false)
  }
  vi.advanceTimersByTime(POPUP_EXIT_MS)
}

describe('popupService / createPopup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    flushStore()
    unsubscribe?.()
    unsubscribe = null
    vi.useRealTimers()
  })

  it('resolves dismissResult immediately when no host is mounted', async () => {
    const handle = createPopup<{ label: string }, string | null>(Noop, { dismissResult: null })

    const result = handle.show({ label: 'x' })

    expect(popupService.getSnapshot()).toHaveLength(0)
    await expect(result).resolves.toBeNull()
  })

  it('mounts an open entry when a host is subscribed', () => {
    subscribeHost()
    const handle = createPopup<{ label: string }, string | null>(Noop, { dismissResult: null })

    void handle.show({ label: 'hello' })

    const entries = popupService.getSnapshot()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ kind: 'component', open: true, props: { label: 'hello' } })
  })

  it('is single-flight: a second show() returns the first promise and ignores new props', () => {
    subscribeHost()
    const handle = createPopup<{ label: string }, string | null>(Noop, { dismissResult: null })

    const first = handle.show({ label: 'A' })
    const second = handle.show({ label: 'B' })

    expect(second).toBe(first)
    expect(popupService.getSnapshot()).toHaveLength(1)
    expect(popupService.getSnapshot()[0]).toMatchObject({ props: { label: 'A' } })
  })

  it('settles via resolve and removes the entry only after the exit phase', async () => {
    subscribeHost()
    const handle = createPopup<{ label: string }, string | null>(Noop, { dismissResult: null })

    const result = handle.show({ label: 'A' })
    const entry = popupService.getSnapshot()[0]

    popupService.settle(entry.instanceId, 'answer')

    // Two-phase: closed but still mounted so the close animation can play.
    expect(popupService.getSnapshot()[0].open).toBe(false)
    await expect(result).resolves.toBe('answer')

    vi.advanceTimersByTime(POPUP_EXIT_MS)
    expect(popupService.getSnapshot()).toHaveLength(0)
  })

  it('settle is idempotent: a second settle neither re-resolves nor double-removes', async () => {
    subscribeHost()
    const handle = createPopup<{ label: string }, string | null>(Noop, { dismissResult: null })

    const result = handle.show({ label: 'A' })
    const { instanceId } = popupService.getSnapshot()[0]

    popupService.settle(instanceId, 'first')
    popupService.settle(instanceId, 'second')

    await expect(result).resolves.toBe('first')
    expect(popupService.getSnapshot()).toHaveLength(1)
  })

  it('hide() settles the in-flight popup with dismissResult', async () => {
    subscribeHost()
    const handle = createPopup<{ label: string }, string | null>(Noop, { dismissResult: null })

    const result = handle.show({ label: 'A' })
    handle.hide()

    await expect(result).resolves.toBeNull()
  })

  it('allows a fresh show() once the previous popup has settled', async () => {
    subscribeHost()
    const handle = createPopup<{ label: string }, string | null>(Noop, { dismissResult: null })

    const first = handle.show({ label: 'A' })
    popupService.settle(popupService.getSnapshot()[0].instanceId, 'a')
    await first

    const second = handle.show({ label: 'B' })
    expect(second).not.toBe(first)
    expect(popupService.getSnapshot().some((entry) => entry.open && entry.kind === 'component')).toBe(true)
  })

  it('confirm() resolves false when no host is mounted', async () => {
    await expect(popup.confirm({ title: 'x' })).resolves.toBe(false)
  })

  it('confirm() mounts a confirm entry and settles to the given result', async () => {
    subscribeHost()

    const pending = popup.confirm({ title: 'Delete?' })
    const entry = popupService.getSnapshot().find((current) => current.kind === 'confirm')

    expect(entry).toMatchObject({ kind: 'confirm', confirmType: 'confirm', open: true })
    popupService.settle(entry!.instanceId, true)

    await expect(pending).resolves.toBe(true)
  })
})
