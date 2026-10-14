import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { KeyboardEventHandler } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { useDictationShortcuts } from '@renderer/hooks/useDictationShortcuts'
import { dictationService, voiceTargetManager } from '@renderer/services/voice'

function Host({ onKeyDown }: { onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement> }) {
  useDictationShortcuts()
  return (
    <div data-voice-target-id="input">
      <textarea
        data-voice-target-id="input"
        aria-label="Dictation input"
        onKeyDown={onKeyDown}
        onFocus={() => voiceTargetManager.markCurrent('input')}
      />
      <input aria-label="Search or YAML property" />
    </div>
  )
}

describe('application-local dictation shortcuts', () => {
  let unbind: () => void
  let stop: Mock<() => Promise<void>>
  let cancel: Mock<() => Promise<void>>
  let start: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.hold_shortcut', 'AltLeft')
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.toggle_shortcut', 'AltLeft+ControlLeft')
    unbind = voiceTargetManager.bind({
      targetId: 'input',
      owner: window,
      sourceEntityId: 'input',
      captureReplaceRange: () => ({ from: 0, to: 0 }),
      replaceRange: () => true
    })
    stop = vi.fn(async () => undefined)
    cancel = vi.fn(async () => undefined)
    start = vi
      .spyOn(dictationService, 'startScoped')
      .mockImplementation(() => ({ result: Promise.resolve(), stop, cancel }))
    vi.spyOn(dictationService, 'getSnapshot').mockReturnValue({ phase: 'idle', elapsedMs: 0, recoveryAvailable: false })
  })
  afterEach(() => {
    unbind()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  const down = (code: string, repeat = false) => fireEvent.keyDown(window, { code, repeat })
  const up = (code: string) => fireEvent.keyUp(window, { code })
  const mount = () => {
    render(<Host />)
    screen.getByRole('textbox', { name: 'Dictation input' }).focus()
  }

  it('consumes the initial hold event before an eligible input action can run', () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.hold_shortcut', 'ControlLeft+Enter')
    const translate = vi.fn()
    render(
      <Host
        onKeyDown={(event) => {
          if (event.ctrlKey && event.key === 'Enter') translate()
        }}
      />
    )
    const input = screen.getByRole('textbox', { name: 'Dictation input' })
    input.focus()
    fireEvent.keyDown(input, { code: 'ControlLeft', key: 'Control', ctrlKey: true })
    expect(fireEvent.keyDown(input, { code: 'Enter', key: 'Enter', ctrlKey: true })).toBe(false)
    expect(translate).not.toHaveBeenCalled()
    void act(() => vi.advanceTimersByTime(350))
    expect(start).toHaveBeenCalledOnce()
    fireEvent.keyUp(input, { code: 'Enter', key: 'Enter', ctrlKey: true })
    fireEvent.keyUp(input, { code: 'ControlLeft', key: 'Control' })
    expect(stop).toHaveBeenCalledOnce()
    fireEvent.keyDown(input, { code: 'ControlRight', key: 'Control', ctrlKey: true })
    fireEvent.keyDown(input, { code: 'Enter', key: 'Enter', ctrlKey: true })
    expect(translate).toHaveBeenCalledOnce()
    fireEvent.keyUp(input, { code: 'Enter', key: 'Enter', ctrlKey: true })
    fireEvent.keyUp(input, { code: 'ControlRight', key: 'Control' })
  })

  it('starts after holding left Alt and stops on release, ignoring a tap and right Alt', () => {
    mount()
    down('AltRight')
    void act(() => vi.advanceTimersByTime(500))
    up('AltRight')
    down('AltLeft')
    void act(() => vi.advanceTimersByTime(100))
    up('AltLeft')
    expect(start).not.toHaveBeenCalled()
    down('AltLeft')
    void act(() => vi.advanceTimersByTime(300))
    down('AltLeft', true)
    expect(start).toHaveBeenCalledTimes(1)
    up('AltLeft')
    expect(stop).toHaveBeenCalledOnce()
  })

  it('toggles with left Ctrl and left Alt without also starting hold dictation', () => {
    mount()
    down('AltLeft')
    void act(() => vi.advanceTimersByTime(100))
    down('ControlLeft')
    down('ControlLeft', true)
    void act(() => vi.advanceTimersByTime(500))
    expect(start).toHaveBeenCalledTimes(1)
    up('AltLeft')
    up('ControlLeft')
    expect(stop).not.toHaveBeenCalled()
    down('ControlLeft')
    down('AltLeft')
    expect(stop).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledTimes(1)
  })

  it.each(['hold', 'toggle'] as const)('consumes matching %s repeats without another recording action', (mode) => {
    MockUsePreferenceUtils.setPreferenceValue(`feature.voice.dictation.${mode}_shortcut`, 'Backspace+ControlLeft')
    mount()
    down('ControlLeft')
    down('Backspace')
    const repeat = () => down('Backspace', true)
    expect(repeat()).toBe(false)
    void act(() => vi.advanceTimersByTime(350))
    expect(start).toHaveBeenCalledOnce()
    expect(repeat()).toBe(false)
    expect(stop).not.toHaveBeenCalled()
    expect(down('KeyX', true)).toBe(true)
    up('Backspace')
    up('ControlLeft')
    if (mode === 'toggle') {
      down('ControlLeft')
      down('Backspace')
      up('Backspace')
      up('ControlLeft')
    }
    expect(stop).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledOnce()
  })

  it.each([
    ['starting', ['ControlLeft']],
    ['recording', ['ControlLeft']],
    ['starting', ['ControlLeft', 'ShiftLeft']],
    ['recording', ['ControlLeft', 'ShiftLeft']],
    ['starting', ['ShiftLeft', 'ControlLeft']],
    ['recording', ['ShiftLeft', 'ControlLeft']]
  ] as const)('keeps the same %s run when a hold becomes a toggle chord with %j', async (initialPhase, extraKeys) => {
    MockUsePreferenceUtils.setPreferenceValue(
      'feature.voice.dictation.toggle_shortcut',
      `AltLeft+${extraKeys.join('+')}`
    )
    let phase: 'idle' | 'starting' | 'recording' = 'idle'
    let finishStart!: () => void
    const result = new Promise<void>((resolve) => {
      finishStart = resolve
    })
    vi.mocked(dictationService.getSnapshot).mockImplementation(() => ({
      phase,
      elapsedMs: 0,
      recoveryAvailable: false
    }))
    start.mockImplementation(() => {
      phase = initialPhase
      return { result, stop, cancel }
    })
    mount()
    down('AltLeft')
    void act(() => vi.advanceTimersByTime(350))
    for (const code of extraKeys) {
      expect(down(code)).toBe(false)
      expect(stop).not.toHaveBeenCalled()
    }
    for (const code of extraKeys) up(code)
    up('AltLeft')
    await act(async () => {
      phase = 'recording'
      finishStart()
    })
    expect(start).toHaveBeenCalledTimes(1)
    expect(stop).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    for (const code of extraKeys) down(code)
    down('AltLeft')
    up('AltLeft')
    for (const code of extraKeys) up(code)
    expect(stop).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledTimes(1)
  })

  it.each(['release', 'unrelated key', 'blur'] as const)('ends an unfinished toggle chord on %s', (reason) => {
    MockUsePreferenceUtils.setPreferenceValue(
      'feature.voice.dictation.toggle_shortcut',
      'AltLeft+ControlLeft+ShiftLeft'
    )
    mount()
    down('AltLeft')
    void act(() => vi.advanceTimersByTime(350))
    down('ControlLeft')
    expect(stop).not.toHaveBeenCalled()
    if (reason === 'release') up('AltLeft')
    else if (reason === 'unrelated key') down('KeyX')
    else fireEvent.blur(window)
    expect(stop).toHaveBeenCalledOnce()
  })

  it('consumes editing keys and their repeats while completing a toggle chord', () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.hold_shortcut', 'ControlLeft')
    MockUsePreferenceUtils.setPreferenceValue(
      'feature.voice.dictation.toggle_shortcut',
      'Backspace+ControlLeft+ShiftLeft'
    )
    mount()
    down('ControlLeft')
    void act(() => vi.advanceTimersByTime(350))
    expect(down('Backspace')).toBe(false)
    expect(down('Backspace', true)).toBe(false)
    expect(stop).not.toHaveBeenCalled()
    down('ShiftLeft')
    up('ShiftLeft')
    up('Backspace')
    up('ControlLeft')
    expect(stop).not.toHaveBeenCalled()
    down('ShiftLeft')
    down('ControlLeft')
    down('Backspace')
    expect(stop).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledOnce()
  })

  it('keeps a held run when an intermediate chord shrinks without releasing the hold key', () => {
    MockUsePreferenceUtils.setPreferenceValue(
      'feature.voice.dictation.toggle_shortcut',
      'AltLeft+ControlLeft+MetaLeft+ShiftLeft'
    )
    mount()
    down('AltLeft')
    void act(() => vi.advanceTimersByTime(350))
    down('ControlLeft')
    down('ShiftLeft')
    up('ShiftLeft')
    expect(stop).not.toHaveBeenCalled()
    up('ControlLeft')
    expect(stop).not.toHaveBeenCalled()
    up('AltLeft')
    expect(stop).toHaveBeenCalledOnce()
  })

  it('stops its recording on window blur and can start after focus returns', () => {
    mount()
    down('AltLeft')
    void act(() => vi.advanceTimersByTime(300))
    fireEvent.blur(window)
    expect(stop).toHaveBeenCalledOnce()
    down('AltLeft')
    void act(() => vi.advanceTimersByTime(300))
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('does not record from a stale target while another input is focused', () => {
    mount()
    const foreign = document.createElement('input')
    document.body.append(foreign)
    foreign.focus()
    down('AltLeft')
    void act(() => vi.advanceTimersByTime(500))
    up('AltLeft')
    down('ControlLeft')
    down('AltLeft')
    expect(start).not.toHaveBeenCalled()
    foreign.remove()
  })

  it('cancels only its scoped recording on unmount', () => {
    const view = render(<Host />)
    screen.getByRole('textbox', { name: 'Dictation input' }).focus()
    down('AltLeft')
    void act(() => vi.advanceTimersByTime(300))
    view.unmount()
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('does not inherit a document target in its search or YAML property input', () => {
    mount()
    screen.getByRole('textbox', { name: 'Search or YAML property' }).focus()
    down('AltLeft')
    void act(() => vi.advanceTimersByTime(500))
    up('AltLeft')
    down('ControlLeft')
    down('AltLeft')
    expect(start).not.toHaveBeenCalled()
  })
})
