import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDictationMouseHold } from '@renderer/hooks/useDictationMouseHold'
import { dictationService, voiceService, voiceTargetManager } from '@renderer/services/voice'

function Host({ revision = 0 }: { revision?: number }) {
  useDictationMouseHold()
  return <textarea key={revision} aria-label="Dictation input" data-voice-target-id="input" />
}

function pointer(
  element: Element | Window,
  type: string,
  init: MouseEventInit & { pointerId?: number; pointerType?: string; isPrimary?: boolean } = {}
) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...init })
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId ?? 1 },
    pointerType: { value: init.pointerType ?? 'mouse' },
    isPrimary: { value: init.isPrimary ?? true }
  })
  fireEvent(element, event)
}

describe('mouse hold dictation', () => {
  const stop = vi.fn(async () => undefined)
  const cancel = vi.fn(async () => undefined)
  let unbind: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.mouse_hold_enabled', true)
    unbind = voiceTargetManager.bind({
      targetId: 'input',
      owner: window,
      sourceEntityId: 'input',
      captureReplaceRange: () => ({ from: 0, to: 0 }),
      replaceRange: () => true
    })
    vi.spyOn(dictationService, 'getSnapshot').mockReturnValue({ phase: 'idle', elapsedMs: 0, recoveryAvailable: false })
    vi.spyOn(dictationService, 'startScoped').mockReturnValue({ result: Promise.resolve(), stop, cancel })
    stop.mockClear()
    cancel.mockClear()
  })

  afterEach(() => {
    unbind()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('starts after 800 ms in the input and stops its own run on release', () => {
    render(<Host />)
    const input = screen.getByRole('textbox')
    input.focus()
    pointer(input, 'pointerdown')
    void act(() => vi.advanceTimersByTime(799))
    expect(dictationService.startScoped).not.toHaveBeenCalled()
    void act(() => vi.advanceTimersByTime(1))
    expect(dictationService.startScoped).toHaveBeenCalledOnce()
    expect(voiceTargetManager.captureCurrent()?.targetId).toBe('input')
    pointer(window, 'pointerup', { buttons: 0 })
    expect(stop).toHaveBeenCalledOnce()
  })

  it.each(['release', 'unmount'])('preserves startup failure after mouse %s', async (ending) => {
    vi.mocked(dictationService.getSnapshot).mockRestore()
    vi.mocked(dictationService.startScoped).mockRestore()
    vi.spyOn(voiceService, 'initialize').mockRejectedValue({ reason: 'voice_unavailable' })
    const host = render(<Host />)
    try {
      const input = screen.getByRole('textbox')
      input.focus()
      pointer(input, 'pointerdown')
      await act(async () => vi.advanceTimersByTimeAsync(800))
      expect(dictationService.getSnapshot()).toMatchObject({ phase: 'failed', error: 'voice_unavailable' })

      await act(async () => {
        if (ending === 'release') pointer(window, 'pointerup', { buttons: 0 })
        else host.unmount()
      })

      expect(dictationService.getSnapshot()).toMatchObject({ phase: 'failed', error: 'voice_unavailable' })
    } finally {
      host.unmount()
      await dictationService.teardown()
    }
  })

  it.each([
    { button: 2, buttons: 2 },
    { pointerType: 'touch' },
    { isPrimary: false },
    { ctrlKey: true },
    { altKey: true },
    { shiftKey: true },
    { metaKey: true }
  ])('preserves ordinary alternative gestures (%j)', (init) => {
    render(<Host />)
    const input = screen.getByRole('textbox')
    input.focus()
    pointer(input, 'pointerdown', init)
    void act(() => vi.advanceTimersByTime(900))
    expect(dictationService.startScoped).not.toHaveBeenCalled()
  })

  it('keeps double-click selection even when pointerdown has no click count', () => {
    render(<Host />)
    const input = screen.getByRole('textbox')
    input.focus()
    pointer(input, 'pointerdown', { detail: 0 })
    fireEvent.mouseDown(input, { button: 0, buttons: 1, detail: 2 })
    void act(() => vi.advanceTimersByTime(900))
    expect(dictationService.startScoped).not.toHaveBeenCalled()
  })

  it('keeps a held gesture through an editor handoff within the same registered target', async () => {
    const host = render(<Host />)
    const input = screen.getByRole('textbox')
    input.focus()
    pointer(input, 'pointerdown')
    fireEvent.blur(input)
    host.rerender(<Host revision={1} />)
    screen.getByRole('textbox').focus()
    await act(async () => {
      await Promise.resolve()
    })
    void act(() => vi.advanceTimersByTime(800))
    expect(dictationService.startScoped).toHaveBeenCalledOnce()
    pointer(window, 'pointerup')
    expect(stop).toHaveBeenCalledOnce()
  })

  it('does not transfer a pending gesture to a new registration reusing the target id', () => {
    render(<Host />)
    const input = screen.getByRole('textbox')
    input.focus()
    pointer(input, 'pointerdown')
    unbind()
    unbind = voiceTargetManager.bind({
      targetId: 'input',
      owner: window,
      sourceEntityId: 'another-document',
      captureReplaceRange: () => ({ from: 0, to: 0 }),
      replaceRange: () => true
    })
    void act(() => vi.advanceTimersByTime(800))
    expect(dictationService.startScoped).not.toHaveBeenCalled()
  })

  it.each([
    'pointerup',
    'pointercancel',
    'pointerleave',
    'blur',
    'wheel',
    'keydown',
    'beforeinput',
    'compositionstart',
    'contextmenu',
    'dragstart'
  ])('cancels a pending hold on %s', async (type) => {
    render(<Host />)
    const input = screen.getByRole('textbox')
    input.focus()
    pointer(input, 'pointerdown')
    if (type.startsWith('pointer')) pointer(input, type, { buttons: 0 })
    else fireEvent(input, new Event(type, { bubbles: true }))
    if (type === 'blur') {
      input.blur()
      await act(async () => {
        await Promise.resolve()
      })
    }
    void act(() => vi.advanceTimersByTime(900))
    expect(dictationService.startScoped).not.toHaveBeenCalled()
  })

  it('preserves drag selection and ignores small mouse jitter', () => {
    render(<Host />)
    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    input.focus()
    pointer(input, 'pointerdown')
    pointer(window, 'pointermove', { clientX: 7 })
    void act(() => vi.advanceTimersByTime(900))
    expect(dictationService.startScoped).not.toHaveBeenCalled()
    pointer(input, 'pointerdown')
    pointer(window, 'pointermove', { clientX: 2, clientY: 2 })
    void act(() => vi.advanceTimersByTime(800))
    expect(dictationService.startScoped).toHaveBeenCalledOnce()
  })

  it('does not start over selected text or in an auxiliary input', () => {
    render(
      <>
        <Host />
        <input aria-label="Search" />
      </>
    )
    const input = screen.getByRole('textbox', { name: 'Dictation input' }) as HTMLTextAreaElement
    input.value = 'selected text'
    input.focus()
    pointer(input, 'pointerdown')
    input.setSelectionRange(0, 8)
    fireEvent(document, new Event('selectionchange'))
    void act(() => vi.advanceTimersByTime(900))
    const search = screen.getByRole('textbox', { name: 'Search' })
    search.focus()
    pointer(search, 'pointerdown')
    void act(() => vi.advanceTimersByTime(900))
    expect(dictationService.startScoped).not.toHaveBeenCalled()
  })

  it.each([
    { phase: 'recording' as const, recoveryAvailable: false },
    { phase: 'failed' as const, retryAvailable: true as const, recoveryAvailable: false },
    { phase: 'idle' as const, recoveryAvailable: true }
  ])('leaves an existing recording or recoverable result untouched (%j)', (snapshot) => {
    vi.mocked(dictationService.getSnapshot).mockReturnValue({ elapsedMs: 0, ...snapshot })
    render(<Host />)
    const input = screen.getByRole('textbox')
    input.focus()
    pointer(input, 'pointerdown')
    void act(() => vi.advanceTimersByTime(900))
    pointer(window, 'pointerup')
    expect(dictationService.startScoped).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
  })

  it('honors the disabled preference', () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.mouse_hold_enabled', false)
    render(<Host />)
    const input = screen.getByRole('textbox')
    input.focus()
    pointer(input, 'pointerdown')
    void act(() => vi.advanceTimersByTime(900))
    expect(dictationService.startScoped).not.toHaveBeenCalled()
  })

  it('releases a starting run immediately and cancels its own run on unmount', () => {
    vi.mocked(dictationService.startScoped).mockReturnValue({ result: new Promise(() => {}), stop, cancel })
    const host = render(<Host />)
    const input = screen.getByRole('textbox')
    input.focus()
    pointer(input, 'pointerdown')
    void act(() => vi.advanceTimersByTime(800))
    pointer(window, 'pointerup')
    expect(stop).toHaveBeenCalledOnce()
    pointer(input, 'pointerdown')
    void act(() => vi.advanceTimersByTime(800))
    host.unmount()
    expect(cancel).toHaveBeenCalledOnce()
  })
})
