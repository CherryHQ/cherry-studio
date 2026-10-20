import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type RefObject, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import { VoiceTargetManager } from '@renderer/services/voice/VoiceTargetManager'

vi.unmock('@cherrystudio/ui')

const voice = vi.hoisted(() => ({
  markCurrent: vi.fn(() => true),
  targets: undefined as VoiceTargetManager | undefined,
  startScoped: vi.fn(() => ({ result: Promise.resolve(), cancel: vi.fn() })),
  stop: vi.fn(),
  cancel: vi.fn(),
  retry: vi.fn(),
  insertRecovery: vi.fn(),
  copyRecovery: vi.fn(),
  discard: vi.fn(),
  transcribeRecording: vi.fn(),
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
    discard: voice.discard,
    transcribeRecording: voice.transcribeRecording
  },
  get voiceTargetManager() {
    return voice.targets ?? { markCurrent: voice.markCurrent }
  }
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
        'settings.voice.action.transcribe': 'Transcribe',
        'settings.voice.action.retry': 'Retry transcription',
        'settings.voice.action.insert_recovery': 'Insert transcript',
        'settings.voice.action.discard': 'Discard transcript',
        'settings.voice.dictation.elapsed': '2 s',
        'settings.voice.dictation.phase.recording': 'Recording',
        'settings.voice.dictation.phase.recorded': 'Ready to transcribe',
        'settings.voice.dictation.phase.transcribing': 'Transcribing',
        'settings.voice.dictation.phase.recovery': 'Transcript ready to recover',
        'settings.voice.dictation.phase.failed': 'Dictation failed',
        'settings.voice.status.unconfigured': 'Voice is not configured',
        'settings.voice.status.operation_failed': 'The voice operation failed. Try again.',
        'settings.voice.action.open_settings': 'Open Voice Settings'
      })[key] ?? key
  })
}))

import InputBar from '../InputBar'

describe('InputBar', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    vi.clearAllMocks()
    voice.targets = undefined
    voice.insertRecovery.mockReset().mockReturnValue('inserted')
    voice.snapshot = { phase: 'idle', elapsedMs: 0, recoveryAvailable: false }
  })

  const emitSnapshot = (snapshot: typeof voice.snapshot) => {
    voice.snapshot = snapshot
    voice.listeners.forEach((listener) => listener())
  }

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

  it.each(['Stop recording', 'Cancel dictation'])(
    'keeps keyboard focus on %s across recording updates',
    async (control) => {
      const user = userEvent.setup()
      const submit = vi.fn()
      voice.snapshot = { phase: 'recording', elapsedMs: 0, recoveryAvailable: false }
      render(
        <InputBar
          text="existing draft"
          placeholder="Ask"
          loading={false}
          handleKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
          handleChange={vi.fn()}
        />
      )
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      await user.tab()
      if (control === 'Cancel dictation') await user.tab()
      expect(screen.getByRole('button', { name: control })).toHaveFocus()

      await act(async () => {
        emitSnapshot({ phase: 'recording', elapsedMs: 1_000, recoveryAvailable: false })
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(screen.getByRole('button', { name: control })).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(submit).not.toHaveBeenCalled()
      expect(control === 'Stop recording' ? voice.stop : voice.cancel).toHaveBeenCalledTimes(1)
    }
  )

  it('restores input focus when generation finishes and cancels pending focus on loading', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const props = { text: 'draft', placeholder: 'Ask', handleKeyDown: vi.fn(), handleChange: vi.fn() }
    const view = render(
      <>
        <button type="button">Elsewhere</button>
        <InputBar {...props} loading={false} />
      </>
    )
    screen.getByRole('button', { name: 'Elsewhere' }).focus()
    view.rerender(
      <>
        <button type="button">Elsewhere</button>
        <InputBar {...props} loading />
      </>
    )
    act(() => {
      vi.runOnlyPendingTimers()
    })
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus()
    view.rerender(
      <>
        <button type="button">Elsewhere</button>
        <InputBar {...props} loading={false} />
      </>
    )
    act(() => {
      vi.runOnlyPendingTimers()
    })
    expect(screen.getByRole('textbox')).toHaveFocus()
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

  it('inserts recovery into its own target when binding arrives after focus', async () => {
    const user = userEvent.setup()
    const targets = new VoiceTargetManager()
    voice.targets = targets
    voice.snapshot = { phase: 'recovery', elapsedMs: 0, recoveryAvailable: true }
    voice.insertRecovery.mockImplementation(() => targets.insertIntoCurrent('recovered words', 'user_recovery'))
    let bind!: () => () => void
    function InputHarness() {
      const [text, setText] = useState('draft: ')
      const inputRef = useRef<HTMLInputElement>(null)
      bind = () =>
        targets.bind({
          targetId: 'new-topic-input',
          sourceEntityId: 'new-topic',
          owner: window,
          captureReplaceRange: () => ({ from: inputRef.current!.selectionStart!, to: inputRef.current!.selectionEnd! }),
          replaceRange: ({ from, to }, inserted) => {
            setText((current) => current.slice(0, from) + inserted + current.slice(to))
            return true
          }
        })
      return (
        <InputBar
          text={text}
          inputRef={inputRef}
          placeholder="Ask"
          loading={false}
          dictationTargetId="new-topic-input"
          handleKeyDown={vi.fn()}
          handleChange={(event) => setText(event.target.value)}
        />
      )
    }
    render(<InputHarness />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    await user.click(input)
    input.setSelectionRange(7, 7)
    const unbind = bind()
    try {
      expect(targets.captureCurrent()).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Insert transcript' }))
      expect(input).toHaveValue('draft: recovered words')
    } finally {
      unbind()
    }
  })

  it('keeps recovery actions available and reports an unavailable insertion target', async () => {
    voice.snapshot = { phase: 'recovery', elapsedMs: 0, recoveryAvailable: true }
    voice.insertRecovery.mockReturnValue('unavailable')
    render(
      <InputBar
        text="draft"
        placeholder="Ask"
        loading={false}
        dictationTargetId="input"
        handleKeyDown={vi.fn()}
        handleChange={vi.fn()}
      />
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Insert transcript' }))
    expect(toast.error).toHaveBeenCalledWith('The voice operation failed. Try again.')
    expect(screen.getByRole('textbox')).toHaveValue('draft')
    expect(screen.getByRole('button', { name: 'Copy transcript' })).toBeEnabled()
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

  it('retains an interrupted recording until the user transcribes or discards it', async () => {
    voice.snapshot = { phase: 'recorded', elapsedMs: 2000, recoveryAvailable: false }
    render(
      <InputBar
        text="draft"
        placeholder="Ask a model"
        loading={false}
        dictationTargetId="quick-assistant-input:temp-topic"
        handleKeyDown={vi.fn()}
        handleChange={vi.fn()}
      />
    )
    const user = userEvent.setup()

    expect(screen.getByRole('status')).toHaveTextContent('Ready to transcribe')
    expect(screen.queryByRole('button', { name: 'Dictate' })).not.toBeInTheDocument()
    expect(voice.transcribeRecording).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Transcribe' }))
    expect(voice.transcribeRecording).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Discard transcript' }))
    expect(voice.discard).toHaveBeenCalledOnce()
    expect(voice.startScoped).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('Ask a model')).toHaveValue('draft')
  })
})
