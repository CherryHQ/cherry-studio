import { MINI_APP_GUEST_LIMITS } from '@shared/ipc/schemas/miniAppBridge'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const readText = vi.fn(() => 'from the user')
const writeText = vi.fn()
const guest = { isFocused: vi.fn(() => true) }
vi.mock('electron', () => ({
  clipboard: { readText, writeText },
  webContents: { fromId: (id: number) => (id === 7 ? guest : undefined) }
}))

const { visible } = vi.hoisted(() => ({ visible: { value: true } }))
vi.mock('@application', async () => {
  const { mockMiniAppApplication } = await import('../../__tests__/applicationMock')
  return mockMiniAppApplication({ MiniAppRuntimeService: { isGuestVisible: () => visible.value } })
})

const { clipboardCapability } = await import('../clipboard')
const { PermissionDeniedError } = await import('../../grants')
const { RateLimitedError } = await import('../quota')

const A = 'com.example.a'
const SENDER = 7

beforeEach(() => {
  readText.mockClear()
  writeText.mockClear()
  guest.isFocused.mockReturnValue(true)
  visible.value = true
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('cherry.clipboard', () => {
  it('writes the text of a focused app', async () => {
    await expect(clipboardCapability.write(A, { text: 'copied' }, SENDER)).resolves.toEqual({ ok: true })
    expect(writeText).toHaveBeenCalledWith('copied')
  })

  it('refuses to write for an app without keyboard focus, touching nothing', async () => {
    // The bug this guards: clipboard hijacking — a background app replacing what the
    // user is about to paste. Focus is the one signal they give without a dialog.
    guest.isFocused.mockReturnValue(false)

    await expect(clipboardCapability.write(A, { text: 'evil' }, SENDER)).rejects.toThrow(PermissionDeniedError)
    await expect(clipboardCapability.write(A, { text: 'evil' }, SENDER)).rejects.toThrow(/keyboard focus/)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('reads the text of a focused app, and nothing for an unfocused one', async () => {
    await expect(clipboardCapability.read(A, SENDER)).resolves.toEqual({ text: 'from the user' })

    guest.isFocused.mockReturnValue(false)
    await expect(clipboardCapability.read(A, SENDER)).rejects.toThrow(PermissionDeniedError)
  })

  it('refuses a focused guest whose pane is hidden — visibility is checked, not inferred', async () => {
    // Focus normally implies visibility, but that is Chromium's behaviour; the gate
    // must hold on the host's own state alone.
    visible.value = false

    await expect(clipboardCapability.read(A, SENDER)).rejects.toThrow(PermissionDeniedError)
    await expect(clipboardCapability.write(A, { text: 'x' }, SENDER)).rejects.toThrow(PermissionDeniedError)
    expect(readText).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('treats a sender it cannot find as unfocused', async () => {
    await expect(clipboardCapability.read(A, 99)).rejects.toThrow(PermissionDeniedError)
    expect(readText).not.toHaveBeenCalled()
  })

  it('clips a read to the cap instead of refusing it', async () => {
    // The app cannot shrink what someone else put on the clipboard, so an oversized
    // clipboard must still be readable — as much of it as the contract allows.
    readText.mockReturnValueOnce('y'.repeat(MINI_APP_GUEST_LIMITS.clipboardTextChars + 5))

    const { text } = await clipboardCapability.read(A, SENDER)
    expect(text).toHaveLength(MINI_APP_GUEST_LIMITS.clipboardTextChars)
  })

  it('rejects an over-long write before touching the clipboard', async () => {
    const text = 'x'.repeat(MINI_APP_GUEST_LIMITS.clipboardTextChars + 1)

    await expect(clipboardCapability.write(A, { text }, SENDER)).rejects.toThrow()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('rate limits writes at 30 and reads at 10 a minute, separately, refilling after the window', async () => {
    // The limiters are module singletons: open a window the cases above have not touched.
    vi.advanceTimersByTime(61_000)
    for (let i = 0; i < 30; i++) await clipboardCapability.write(A, { text: 't' }, SENDER)
    await expect(clipboardCapability.write(A, { text: 't' }, SENDER)).rejects.toThrow(RateLimitedError)
    // Reads keep their own budget: a copy-happy app does not lose its paste button.
    for (let i = 0; i < 10; i++) await clipboardCapability.read(A, SENDER)
    await expect(clipboardCapability.read(A, SENDER)).rejects.toThrow(RateLimitedError)

    vi.advanceTimersByTime(61_000)
    await expect(clipboardCapability.write(A, { text: 't' }, SENDER)).resolves.toEqual({ ok: true })
    await expect(clipboardCapability.read(A, SENDER)).resolves.toBeDefined()
  })
})
