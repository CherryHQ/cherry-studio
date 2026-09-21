import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RefObject } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const voice = vi.hoisted(() => ({
  markCurrent: vi.fn(() => true),
  startScoped: vi.fn(() => ({ result: Promise.resolve(), cancel: vi.fn() })),
  stop: vi.fn(),
  cancel: vi.fn(),
  retry: vi.fn(),
  insertRecovery: vi.fn(),
  copyRecovery: vi.fn(),
  discard: vi.fn(),
  snapshot: { phase: 'idle', elapsedMs: 0, recoveryAvailable: false } as {
    phase: string
    elapsedMs: number
    recoveryAvailable: boolean
    retryAvailable?: true
    error?: string
  },
  listeners: new Set<() => void>()
}))

const navigation = vi.hoisted(() => ({ openSettingsTab: vi.fn() }))

vi.mock('@renderer/services/voice', () => ({
  dictationService: {
    subscribe: (listener: () => void) => {
      voice.listeners.add(listener)
      return () => voice.listeners.delete(listener)
    },
    getSnapshot: () => voice.snapshot,
    startScoped: voice.startScoped,
    stop: voice.stop,
    cancel: voice.cancel,
    retry: voice.retry,
    insertRecovery: voice.insertRecovery,
    copyRecovery: voice.copyRecovery,
    discard: voice.discard
  },
  voiceTargetManager: { markCurrent: voice.markCurrent }
}))

vi.mock('@renderer/services/mainWindowNavigation', () => navigation)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'chat.input.dictation.title': 'Dictate',
        'chat.input.dictation.action.cancel': 'Cancel dictation',
        'chat.input.dictation.action.copy_recovery': 'Copy transcript',
        'settings.voice.action.stop_recording': 'Stop recording',
        'settings.voice.action.retry': 'Retry transcription',
        'settings.voice.action.insert_recovery': 'Insert transcript',
        'settings.voice.action.discard': 'Discard transcript',
        'settings.voice.dictation.elapsed': '2 s',
        'settings.voice.dictation.phase.recording': 'Recording',
        'settings.voice.dictation.phase.transcribing': 'Transcribing',
        'settings.voice.dictation.phase.recovery': 'Transcript ready to recover',
        'settings.voice.dictation.phase.failed': 'Dictation failed',
        'settings.voice.status.unconfigured': 'Voice is not configured',
        'settings.voice.action.open_settings': 'Open Voice Settings'
      })[key] ?? key
  })
}))

import InputBar from '../InputBar'

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: vi.fn() })
}))

describe('InputBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    voice.snapshot = { phase: 'idle', elapsedMs: 0, recoveryAvailable: false }
  })

  const emitSnapshot = (snapshot: typeof voice.snapshot) => {
    voice.snapshot = snapshot
    voice.listeners.forEach((listener) => listener())
  }

  it('stays transparent in both light and dark themes', () => {
    render(<InputBar text="" placeholder="Ask a model" loading handleKeyDown={vi.fn()} handleChange={vi.fn()} />)

    expect(screen.getByPlaceholderText('Ask a model')).toHaveClass(
      'rounded-none',
      'bg-transparent',
      'dark:bg-transparent'
    )
  })

  it('exposes the real text input so callers can capture its live selection', () => {
    const inputRef: RefObject<HTMLInputElement | null> = { current: null }

    render(
      <InputBar
        text="draft"
        placeholder="Ask a model"
        loading
        inputRef={inputRef}
        handleKeyDown={vi.fn()}
        handleChange={vi.fn()}
      />
    )

    const input = screen.getByPlaceholderText('Ask a model') as HTMLInputElement
    input.setSelectionRange(1, 4)

    expect(inputRef.current).toBe(input)
    expect(inputRef.current?.selectionStart).toBe(1)
    expect(inputRef.current?.selectionEnd).toBe(4)
  })

  it('starts dictation only after the user activates the microphone', async () => {
    const user = userEvent.setup()
    render(
      <InputBar
        text=""
        placeholder="Ask a model"
        loading={false}
        dictationTargetId="quick-assistant-input:temp-topic"
        handleKeyDown={vi.fn()}
        handleChange={vi.fn()}
      />
    )

    expect(voice.startScoped).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Dictate' }))

    expect(voice.markCurrent).toHaveBeenCalledWith('quick-assistant-input:temp-topic')
    expect(voice.startScoped).toHaveBeenCalledOnce()
  })

  it('marks the input as the current recovery target on focus or pointer interaction without starting dictation', () => {
    render(
      <InputBar
        text=""
        placeholder="Ask a model"
        loading={false}
        dictationTargetId="quick-assistant-input:temp-topic"
        handleKeyDown={vi.fn()}
        handleChange={vi.fn()}
      />
    )

    const input = screen.getByPlaceholderText('Ask a model')
    voice.markCurrent.mockClear()
    fireEvent.focus(input)
    fireEvent.pointerDown(input)

    expect(voice.markCurrent).toHaveBeenNthCalledWith(1, 'quick-assistant-input:temp-topic')
    expect(voice.markCurrent).toHaveBeenNthCalledWith(2, 'quick-assistant-input:temp-topic')
    expect(voice.startScoped).not.toHaveBeenCalled()
  })

  it('offers stop and cancel while recording, then exposes explicit recovery actions', async () => {
    const user = userEvent.setup()
    render(
      <InputBar
        text=""
        placeholder="Ask a model"
        loading={false}
        dictationTargetId="quick-assistant-input:temp-topic"
        handleKeyDown={vi.fn()}
        handleChange={vi.fn()}
      />
    )

    act(() => emitSnapshot({ phase: 'recording', elapsedMs: 2_000, recoveryAvailable: false }))
    expect(screen.getByRole('status')).toHaveTextContent('Recording')
    await user.click(screen.getByRole('button', { name: 'Stop recording' }))
    await user.click(screen.getByRole('button', { name: 'Cancel dictation' }))
    expect(voice.stop).toHaveBeenCalledOnce()
    expect(voice.cancel).toHaveBeenCalledOnce()

    act(() => emitSnapshot({ phase: 'recovery', elapsedMs: 0, recoveryAvailable: true }))
    expect(screen.getByRole('status')).toHaveTextContent('Transcript ready to recover')
    await user.click(screen.getByRole('button', { name: 'Insert transcript' }))
    await user.click(screen.getByRole('button', { name: 'Copy transcript' }))
    await user.click(screen.getByRole('button', { name: 'Discard transcript' }))
    expect(voice.insertRecovery).toHaveBeenCalledOnce()
    expect(voice.copyRecovery).toHaveBeenCalledOnce()
    expect(voice.discard).toHaveBeenCalledOnce()
  })

  it('shows stable configuration recovery without choosing a fallback', async () => {
    const user = userEvent.setup()
    render(
      <InputBar
        text="unchanged"
        placeholder="Ask a model"
        loading={false}
        dictationTargetId="quick-assistant-input:temp-topic"
        handleKeyDown={vi.fn()}
        handleChange={vi.fn()}
      />
    )

    act(() =>
      emitSnapshot({
        phase: 'failed',
        elapsedMs: 0,
        recoveryAvailable: false,
        retryAvailable: true,
        error: 'model_required'
      })
    )

    expect(screen.getByRole('status')).toHaveTextContent('Voice is not configured')
    await user.click(screen.getByRole('button', { name: 'Open Voice Settings' }))

    expect(navigation.openSettingsTab).toHaveBeenCalledWith('/settings/voice')
    expect(screen.getByPlaceholderText('Ask a model')).toHaveValue('unchanged')
    expect(voice.startScoped).not.toHaveBeenCalled()
  })
})
