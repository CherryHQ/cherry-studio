import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { KeyboardEventHandler } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { CommandProvider } from '@renderer/components/command/CommandProvider'
import { useCommandHandler } from '@renderer/hooks/command'
import { useDictationShortcuts } from '@renderer/hooks/useDictationShortcuts'
import { dictationService, voiceTargetManager } from '@renderer/services/voice'
import type * as PlatformUtils from '@renderer/utils/platform'
import { commandShortcutPreferenceKey } from '@shared/utils/command'

const platform = vi.hoisted(() => ({ isMac: false }))
vi.mock('@renderer/utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof PlatformUtils>()),
  get isMac() {
    return platform.isMac
  }
}))

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

function CommandHost({ onClose }: { onClose: () => void }) {
  useCommandHandler('tab.close', onClose)
  return <Host />
}

describe('application-local dictation shortcuts', () => {
  let unbind: () => void
  let stop: Mock<() => Promise<void>>
  let cancel: Mock<() => Promise<void>>
  let start: ReturnType<typeof vi.spyOn>
  const heldKeys = new Set<string>()

  const bindInput = () =>
    voiceTargetManager.bind({
      targetId: 'input',
      owner: window,
      sourceEntityId: 'input',
      captureReplaceRange: () => ({ from: 0, to: 0 }),
      replaceRange: () => true
    })

  beforeEach(() => {
    vi.useFakeTimers()
    heldKeys.clear()
    platform.isMac = false
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.hold_shortcut', 'AltLeft')
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.toggle_shortcut', 'AltLeft+ControlLeft')
    unbind = bindInput()
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

  const modifierFlags = () => ({
    ctrlKey: heldKeys.has('ControlLeft') || heldKeys.has('ControlRight'),
    altKey: heldKeys.has('AltLeft') || heldKeys.has('AltRight'),
    shiftKey: heldKeys.has('ShiftLeft') || heldKeys.has('ShiftRight'),
    metaKey: heldKeys.has('MetaLeft') || heldKeys.has('MetaRight')
  })
  const down = (code: string, repeat = false) => {
    heldKeys.add(code)
    return fireEvent.keyDown(window, { code, repeat, ...modifierFlags() })
  }
  const up = (code: string) => {
    heldKeys.delete(code)
    return fireEvent.keyUp(window, { code, ...modifierFlags() })
  }
  const mount = () => {
    render(<Host />)
    screen.getByRole('textbox', { name: 'Dictation input' }).focus()
  }

  it('keeps Alt release-to-stop after an intercepted Control release', () => {
    mount()
    fireEvent.keyDown(window, { code: 'ControlLeft', key: 'Control', ctrlKey: true })
    // A native command intercepted the remaining chord and its releases.
    fireEvent.keyDown(window, { code: 'AltLeft', key: 'Alt', altKey: true })
    expect(start).not.toHaveBeenCalled()
    void act(() => vi.advanceTimersByTime(350))
    expect(start).toHaveBeenCalledOnce()
    fireEvent.keyUp(window, { code: 'AltLeft', key: 'Alt' })
    expect(stop).toHaveBeenCalledOnce()
  })

  it('preserves a held run when Control and Alt are reported as AltGraph', () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.toggle_shortcut', 'AltLeft+ControlLeft+KeyE')
    mount()
    down('AltLeft')
    void act(() => vi.advanceTimersByTime(350))
    expect(start).toHaveBeenCalledOnce()
    down('ControlLeft')
    expect(fireEvent.keyDown(window, { code: 'KeyE', key: '€', modifierAltGraph: true })).toBe(false)
    expect(stop).not.toHaveBeenCalled()
    fireEvent.keyUp(window, { code: 'KeyE', key: '€', modifierAltGraph: true })
    up('ControlLeft')
    up('AltLeft')
    expect(stop).not.toHaveBeenCalled()
    expect(start).toHaveBeenCalledOnce()
  })

  it('allows a configured shortcut in a window without a command dispatcher', () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.hold_shortcut', 'ControlLeft+KeyW')
    MockUsePreferenceUtils.setPreferenceValue(commandShortcutPreferenceKey('tab.close'), {
      binding: ['CommandOrControl', 'W'],
      enabled: false
    })
    mount()
    down('ControlLeft')
    down('KeyW')
    void act(() => vi.advanceTimersByTime(350))
    expect(start).toHaveBeenCalledOnce()
    up('KeyW')
    expect(stop).toHaveBeenCalledOnce()
  })

  it.each([
    ['ControlLeft', 'AltLeft', 'ShiftLeft'],
    ['ShiftLeft', 'ControlLeft', 'AltLeft']
  ])('does not activate a saved hold/toggle conflict in order %j', (...codes) => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.hold_shortcut', 'AltLeft+ControlLeft+ShiftLeft')
    mount()
    for (const code of codes) expect(down(code)).toBe(true)
    void act(() => vi.advanceTimersByTime(350))
    for (const code of codes) up(code)
    expect(start).not.toHaveBeenCalled()
  })

  it.each(['binding', 'enabled'] as const)('yields to a command after its %s changes', (change) => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.hold_shortcut', 'ControlLeft+KeyB')
    const preferenceKey = commandShortcutPreferenceKey('tab.close')
    MockUsePreferenceUtils.setPreferenceValue(preferenceKey, {
      binding: ['CommandOrControl', change === 'binding' ? 'W' : 'B'],
      enabled: change === 'binding'
    })
    const closeTab = vi.fn()
    const tree = () => (
      <CommandProvider>
        <CommandHost onClose={closeTab} />
      </CommandProvider>
    )
    const { rerender } = render(tree())
    const input = screen.getByRole('textbox', { name: 'Dictation input' })
    input.focus()
    fireEvent.keyDown(input, { code: 'ControlLeft', key: 'Control', ctrlKey: true })
    expect(fireEvent.keyDown(input, { code: 'KeyB', key: 'b', ctrlKey: true })).toBe(false)
    void act(() => vi.advanceTimersByTime(100))
    MockUsePreferenceUtils.setPreferenceValue(preferenceKey, { binding: ['CommandOrControl', 'B'], enabled: true })
    rerender(tree())
    void act(() => vi.advanceTimersByTime(300))
    expect(start).not.toHaveBeenCalled()
    fireEvent.keyUp(input, { code: 'KeyB', key: 'b', ctrlKey: true })
    fireEvent.keyUp(input, { code: 'ControlLeft', key: 'Control' })
    fireEvent.keyDown(input, { code: 'ControlLeft', key: 'Control', ctrlKey: true })
    fireEvent.keyDown(input, { code: 'KeyB', key: 'b', ctrlKey: true })
    expect(closeTab).toHaveBeenCalledOnce()
    void act(() => vi.advanceTimersByTime(350))
    expect(start).not.toHaveBeenCalled()
    fireEvent.keyUp(input, { code: 'KeyB', key: 'b', ctrlKey: true })
    fireEvent.keyUp(input, { code: 'ControlLeft', key: 'Control' })
    MockUsePreferenceUtils.setPreferenceValue(preferenceKey, { binding: ['CommandOrControl', 'B'], enabled: false })
    rerender(tree())
    fireEvent.keyDown(input, { code: 'ControlLeft', key: 'Control', ctrlKey: true })
    fireEvent.keyDown(input, { code: 'KeyB', key: 'b', ctrlKey: true })
    void act(() => vi.advanceTimersByTime(350))
    expect(start).toHaveBeenCalledOnce()
    vi.mocked(dictationService.getSnapshot).mockReturnValue({
      phase: 'recording',
      elapsedMs: 0,
      recoveryAvailable: false
    })
    MockUsePreferenceUtils.setPreferenceValue(preferenceKey, { binding: ['CommandOrControl', 'W'], enabled: true })
    rerender(tree())
    expect(cancel).not.toHaveBeenCalled()
    fireEvent.keyUp(input, { code: 'KeyB', key: 'b', ctrlKey: true })
    expect(stop).toHaveBeenCalledOnce()
  })

  it('leaves a newly conflicting toggle constituent available to its command', () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.hold_shortcut', 'AltRight')
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.toggle_shortcut', 'AltLeft+ControlLeft+KeyB')
    const closeTab = vi.fn()
    const tree = () => (
      <CommandProvider>
        <CommandHost onClose={closeTab} />
      </CommandProvider>
    )
    const { rerender } = render(tree())
    const input = screen.getByRole('textbox', { name: 'Dictation input' })
    input.focus()
    MockUsePreferenceUtils.setPreferenceValue(commandShortcutPreferenceKey('tab.close'), {
      binding: ['CommandOrControl', 'B'],
      enabled: true
    })
    rerender(tree())
    fireEvent.keyDown(input, { code: 'ControlLeft', key: 'Control', ctrlKey: true })
    fireEvent.keyDown(input, { code: 'KeyB', key: 'b', ctrlKey: true })
    fireEvent.keyDown(input, { code: 'AltLeft', key: 'Alt', ctrlKey: true, altKey: true })
    expect(closeTab).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
  })

  it.each(['MetaLeft', 'MetaRight'])('recovers both defaults after a missing macOS keyup with %s', (code) => {
    platform.isMac = true
    mount()
    fireEvent.keyDown(window, { code, key: 'Meta', metaKey: true })
    fireEvent.keyDown(window, { code: 'KeyB', key: 'b', metaKey: true })
    // macOS can omit B's keyup while Command is held.
    fireEvent.keyUp(window, { code, key: 'Meta' })
    down('AltLeft')
    void act(() => vi.advanceTimersByTime(300))
    expect(start).toHaveBeenCalledOnce()
    up('AltLeft')
    expect(stop).toHaveBeenCalledOnce()
    down('ControlLeft')
    down('AltLeft')
    expect(start).toHaveBeenCalledTimes(2)
  })

  it.each(['MetaLeft', 'MetaRight'])('does not retrigger a Command chord on a later %s-only press', (code) => {
    platform.isMac = true
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.toggle_shortcut', `${code}+KeyB`)
    mount()
    fireEvent.keyDown(window, { code, key: 'Meta', metaKey: true })
    fireEvent.keyDown(window, { code: 'KeyB', key: 'b', metaKey: true })
    expect(start).toHaveBeenCalledOnce()
    vi.mocked(dictationService.getSnapshot).mockReturnValue({
      phase: 'recording',
      elapsedMs: 0,
      recoveryAvailable: false
    })
    fireEvent.keyUp(window, { code, key: 'Meta' })
    fireEvent.keyDown(window, { code, key: 'Meta', metaKey: true })
    expect(stop).not.toHaveBeenCalled()
    expect(start).toHaveBeenCalledOnce()
  })

  it.each([false, true])('handles another character with Command still held on macOS (%s)', (isMac) => {
    platform.isMac = isMac
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.toggle_shortcut', 'MetaLeft+ShiftRight+KeyC')
    mount()
    fireEvent.keyDown(window, { code: 'ShiftRight', key: 'Shift', shiftKey: true })
    fireEvent.keyDown(window, { code: 'MetaLeft', key: 'Meta', metaKey: true, shiftKey: true })
    fireEvent.keyDown(window, { code: 'KeyB', key: 'b', metaKey: true, shiftKey: true })
    fireEvent.keyDown(window, { code: 'KeyC', key: 'c', metaKey: true, shiftKey: true })
    expect(start).toHaveBeenCalledTimes(isMac ? 1 : 0)
  })

  it('preserves a sided modifier when releasing Command clears a missing character keyup', () => {
    platform.isMac = true
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.toggle_shortcut', 'ControlLeft+ShiftRight')
    mount()
    fireEvent.keyDown(window, { code: 'ShiftRight', key: 'Shift', shiftKey: true })
    fireEvent.keyDown(window, { code: 'MetaLeft', key: 'Meta', metaKey: true, shiftKey: true })
    fireEvent.keyDown(window, { code: 'KeyB', key: 'b', metaKey: true, shiftKey: true })
    fireEvent.keyUp(window, { code: 'MetaLeft', key: 'Meta', shiftKey: true })
    fireEvent.keyDown(window, { code: 'ControlLeft', key: 'Control', ctrlKey: true, shiftKey: true })
    expect(start).toHaveBeenCalledOnce()
  })

  it('keeps consuming an owned character repeat and release after Command is released first', () => {
    platform.isMac = true
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.hold_shortcut', 'MetaLeft+KeyB')
    mount()
    fireEvent.keyDown(window, { code: 'MetaLeft', key: 'Meta', metaKey: true })
    fireEvent.keyDown(window, { code: 'KeyB', key: 'b', metaKey: true })
    void act(() => vi.advanceTimersByTime(300))
    expect(start).toHaveBeenCalledOnce()
    fireEvent.keyUp(window, { code: 'MetaLeft', key: 'Meta' })
    expect(stop).toHaveBeenCalledOnce()
    expect(fireEvent.keyDown(window, { code: 'KeyB', key: 'b', repeat: true })).toBe(false)
    expect(fireEvent.keyUp(window, { code: 'KeyB', key: 'b' })).toBe(false)
    expect(fireEvent.keyDown(window, { code: 'KeyB', key: 'b' })).toBe(true)
  })

  it('keeps a Command hold running while a sided modifier completes its toggle chord', () => {
    platform.isMac = true
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.hold_shortcut', 'MetaLeft+KeyB')
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.toggle_shortcut', 'MetaLeft+KeyB+ShiftRight')
    mount()
    fireEvent.keyDown(window, { code: 'MetaLeft', key: 'Meta', metaKey: true })
    fireEvent.keyDown(window, { code: 'KeyB', key: 'b', metaKey: true })
    void act(() => vi.advanceTimersByTime(300))
    vi.mocked(dictationService.getSnapshot).mockReturnValue({
      phase: 'recording',
      elapsedMs: 0,
      recoveryAvailable: false
    })
    fireEvent.keyDown(window, { code: 'ShiftRight', key: 'Shift', metaKey: true, shiftKey: true })
    fireEvent.keyUp(window, { code: 'MetaLeft', key: 'Meta', shiftKey: true })
    fireEvent.keyUp(window, { code: 'ShiftRight', key: 'Shift' })
    expect(stop).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { code: 'MetaLeft', key: 'Meta', metaKey: true })
    fireEvent.keyDown(window, { code: 'KeyB', key: 'b', metaKey: true })
    fireEvent.keyDown(window, { code: 'ShiftRight', key: 'Shift', metaKey: true, shiftKey: true })
    expect(stop).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledOnce()
  })

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

  it.each(['starting', 'recording'] as const)('leaves a UI-owned %s run untouched by the toggle shortcut', (phase) => {
    vi.mocked(dictationService.getSnapshot).mockReturnValue({ phase, elapsedMs: 0, recoveryAvailable: false })
    const globalStop = vi.spyOn(dictationService, 'stop').mockResolvedValue(undefined)
    mount()
    down('ControlLeft')
    down('AltLeft')
    up('AltLeft')
    up('ControlLeft')
    fireEvent.blur(window)
    expect(globalStop).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
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

  it('keeps consuming an editing key until release when its modifier is released first', () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.hold_shortcut', 'Backspace+ControlLeft')
    mount()
    down('ControlLeft')
    down('Backspace')
    void act(() => vi.advanceTimersByTime(350))
    up('ControlLeft')
    expect(stop).toHaveBeenCalledOnce()
    expect(down('KeyX')).toBe(true)
    expect(down('Backspace', true)).toBe(false)
    expect(down('KeyX', true)).toBe(true)
    up('KeyX')
    up('Backspace')
    expect(down('Backspace')).toBe(true)
  })

  it.each(['still held', 'released outside'] as const)('handles an editing key %s across window blur', (state) => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.hold_shortcut', 'Backspace+ControlLeft')
    mount()
    down('ControlLeft')
    down('Backspace')
    void act(() => vi.advanceTimersByTime(350))
    up('ControlLeft')
    fireEvent.blur(window)
    fireEvent.focus(window)
    if (state === 'released outside') expect(down('Backspace')).toBe(true)
    expect(down('Backspace', true)).toBe(state === 'released outside')
    expect(up('Backspace')).toBe(state === 'released outside')
    expect(down('Backspace')).toBe(true)
    expect(down('Backspace', true)).toBe(true)
    up('Backspace')
    expect(start).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledOnce()
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
      'AltLeft+ControlLeft+ShiftLeft'
    )
    mount()
    down('AltLeft')
    void act(() => vi.advanceTimersByTime(350))
    down('ControlLeft')
    expect(stop).not.toHaveBeenCalled()
    up('ControlLeft')
    expect(stop).not.toHaveBeenCalled()
    up('AltLeft')
    expect(stop).toHaveBeenCalledOnce()
  })

  it.each(['AltLeft', 'ControlLeft+AltLeft'])('consumes key releases belonging to %s', (shortcut) => {
    const onKeyUp = vi.fn()
    mount()
    window.addEventListener('keyup', onKeyUp)
    const codes = shortcut.split('+')
    for (const code of codes) down(code)
    void act(() => vi.advanceTimersByTime(350))
    for (const code of codes) expect(up(code)).toBe(false)
    expect(onKeyUp).not.toHaveBeenCalled()
    window.removeEventListener('keyup', onKeyUp)
  })

  it('does not start a delayed hold after focus leaves and returns to the input', () => {
    mount()
    const input = screen.getByRole('textbox', { name: 'Dictation input' })
    down('AltLeft')
    void act(() => vi.advanceTimersByTime(100))
    screen.getByRole('textbox', { name: 'Search or YAML property' }).focus()
    input.focus()
    void act(() => vi.advanceTimersByTime(250))
    up('AltLeft')
    expect(start).not.toHaveBeenCalled()
  })

  it.each(['hold', 'toggle'] as const)('ignores an invalid saved %s binding', (mode) => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.hold_shortcut', '')
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.toggle_shortcut', '')
    MockUsePreferenceUtils.setPreferenceValue(`feature.voice.dictation.${mode}_shortcut`, 'ControlLeft+KeyW+KeyB')
    mount()
    down('ControlLeft')
    expect(down('KeyW')).toBe(true)
    expect(down('KeyB')).toBe(true)
    void act(() => vi.advanceTimersByTime(350))
    expect(start).not.toHaveBeenCalled()
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

  it.each(['hold', 'toggle'] as const)('preserves retryable audio instead of starting %s dictation', (mode) => {
    vi.mocked(dictationService.getSnapshot).mockReturnValue({
      phase: 'failed',
      elapsedMs: 1000,
      recoveryAvailable: false,
      retryAvailable: true
    })
    mount()
    down('AltLeft')
    if (mode === 'toggle') down('ControlLeft')
    void act(() => vi.advanceTimersByTime(350))
    up('AltLeft')
    if (mode === 'toggle') up('ControlLeft')
    expect(start).not.toHaveBeenCalled()

    vi.mocked(dictationService.getSnapshot).mockReturnValue({
      phase: 'failed',
      elapsedMs: 0,
      recoveryAvailable: false
    })
    down('AltLeft')
    if (mode === 'toggle') down('ControlLeft')
    void act(() => vi.advanceTimersByTime(350))
    expect(start).toHaveBeenCalledOnce()
    up('AltLeft')
    if (mode === 'toggle') up('ControlLeft')
  })

  it.each(['hold', 'toggle'] as const)('starts %s after the focused input is rebound', (mode) => {
    mount()
    const input = document.activeElement
    unbind()
    unbind = bindInput()
    expect(document.activeElement).toBe(input)
    expect(voiceTargetManager.captureCurrent()).toBeNull()

    down('AltLeft')
    if (mode === 'toggle') down('ControlLeft')
    void act(() => vi.advanceTimersByTime(350))
    expect(start).toHaveBeenCalledOnce()
    expect(voiceTargetManager.captureCurrent()?.targetId).toBe('input')
    up('AltLeft')
    if (mode === 'toggle') up('ControlLeft')
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
