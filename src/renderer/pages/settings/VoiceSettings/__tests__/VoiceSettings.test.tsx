import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { type SpeechPlaybackSnapshot, VoiceDomainError } from '@renderer/services/voice'
import { VoiceTargetManager } from '@renderer/services/voice/VoiceTargetManager'
import { APPLE_ASR_MODEL_ID, APPLE_TTS_MODEL_ID, FUNASR_MODEL_ID, VoiceResourceOperation } from '@shared/ai/localVoice'

vi.unmock('@cherrystudio/ui')

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

const voice = vi.hoisted(() => {
  const dictation = { phase: 'idle', elapsedMs: 0, recoveryAvailable: false } as any
  const speech = { phase: 'idle', progress: { completed: 0, total: 0 } } as any
  return {
    dictation,
    speech,
    dictationListeners: new Set<() => void>(),
    speechListeners: new Set<() => void>(),
    enumerateMicrophones: vi.fn(),
    testMicrophone: vi.fn(),
    resolveTranscription: vi.fn(),
    resolveSpeech: vi.fn(),
    listModels: vi.fn(),
    listTranscriptionLocales: vi.fn(),
    getModelStatus: vi.fn(),
    listVoices: vi.fn(),
    install: vi.fn(),
    microphone: vi.fn(),
    openMicrophoneSettings: vi.fn(),
    dictationStartScoped: vi.fn(),
    dictationStop: vi.fn(),
    dictationTranscribe: vi.fn(),
    dictationRetry: vi.fn(),
    dictationDiscard: vi.fn(),
    speechStart: vi.fn(),
    speechStop: vi.fn(),
    funAsrDownload: vi.fn(),
    funAsrCancel: vi.fn(),
    funAsrRemove: vi.fn(),
    funAsrModel: { status: 'not_downloaded', percent: 0, isStatusResolved: true } as any,
    targetManager: undefined as VoiceTargetManager | undefined
  }
})

vi.mock('@renderer/services/voice', async () => ({
  VoiceDomainError: (await import('@renderer/services/voice/VoiceService')).VoiceDomainError,
  getDefaultVoiceLanguage: (await import('@renderer/services/voice/voiceLanguage')).getDefaultVoiceLanguage,
  enumerateMicrophones: voice.enumerateMicrophones,
  subscribeMicrophoneChanges: () => () => undefined,
  voiceService: {
    testMicrophone: voice.testMicrophone,
    downloadModel: voice.funAsrDownload,
    cancelModelDownload: voice.funAsrCancel,
    removeModel: voice.funAsrRemove,
    initialize: vi.fn(async () => undefined),
    resolveTranscriptionConfiguration: voice.resolveTranscription,
    resolveSpeechConfiguration: voice.resolveSpeech,
    listModels: voice.listModels,
    listTranscriptionLocales: voice.listTranscriptionLocales,
    getModelStatus: voice.getModelStatus,
    listVoices: voice.listVoices,
    installTranscriptionAsset: voice.install,
    getMicrophoneStatus: voice.microphone,
    openMicrophoneSettings: voice.openMicrophoneSettings
  },
  dictationService: {
    subscribe: (listener: () => void) => {
      voice.dictationListeners.add(listener)
      return () => voice.dictationListeners.delete(listener)
    },
    getSnapshot: () => voice.dictation,
    startScoped: voice.dictationStartScoped,
    stop: voice.dictationStop,
    transcribeRecording: voice.dictationTranscribe,
    retry: voice.dictationRetry,
    insertRecovery: vi.fn(),
    copyRecovery: vi.fn(),
    discard: voice.dictationDiscard
  },
  speechPlaybackService: {
    subscribe: (listener: () => void) => {
      voice.speechListeners.add(listener)
      return () => voice.speechListeners.delete(listener)
    },
    getSnapshot: () => voice.speech,
    start: voice.speechStart,
    stop: voice.speechStop
  },
  get voiceTargetManager() {
    return voice.targetManager
  }
}))

const confirm = vi.hoisted(() => vi.fn())
vi.mock('@renderer/services/popup', () => ({ popup: { confirm } }))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, hash, children, ...props }: any) => (
    <a href={`${to}${hash ? `#${hash}` : ''}`} {...props}>
      {children}
    </a>
  )
}))

import VoiceSettings from '../VoiceSettings'

const models = [
  {
    id: APPLE_ASR_MODEL_ID,
    name: 'Apple System ASR',
    localeSelection: { defaultLocale: 'en-US' },
    resourceOperations: [VoiceResourceOperation.InstallLocale]
  },
  { id: APPLE_TTS_MODEL_ID, name: 'Apple System TTS', localeSelection: null, resourceOperations: [] },
  {
    id: FUNASR_MODEL_ID,
    name: 'FunASR Nano',
    localeSelection: null,
    resourceOperations: [
      VoiceResourceOperation.Download,
      VoiceResourceOperation.CancelDownload,
      VoiceResourceOperation.Remove
    ]
  }
]

function publishSpeech(snapshot: SpeechPlaybackSnapshot) {
  act(() => {
    voice.speech = snapshot
    voice.speechListeners.forEach((listener) => listener())
  })
}

async function renderPreviewTest() {
  MockUsePreferenceUtils.setMultiplePreferenceValues({
    'feature.voice.speech.model_id': APPLE_TTS_MODEL_ID,
    'feature.voice.speech.voice_id': 'voice.exact',
    'feature.voice.speech.language': 'en-US'
  })
  const user = userEvent.setup()
  render(<VoiceSettings />)
  await user.click(screen.getByRole('button', { name: 'Use custom preview text' }))
  const input = screen.getByRole('textbox', { name: /preview text/i })
  await user.type(input, 'Read this preview.')
  const play = screen.getByRole('button', { name: /play preview/i })
  await waitFor(() => expect(play).toBeEnabled())
  return { input, play, user }
}

describe('VoiceSettings', () => {
  beforeAll(async () => {
    if (!HTMLElement.prototype.hasPointerCapture) HTMLElement.prototype.hasPointerCapture = () => false
    if (!HTMLElement.prototype.releasePointerCapture) HTMLElement.prototype.releasePointerCapture = () => {}
    if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => {}
    HTMLElement.prototype.scrollIntoView = () => {}
    await i18n.changeLanguage('en-US')
  })

  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
    MockUsePreferenceUtils.resetMocks()
    voice.targetManager = new VoiceTargetManager()
    voice.enumerateMicrophones.mockReset().mockResolvedValue([{ deviceId: 'usb-mic', label: 'USB Microphone' }])
    voice.testMicrophone.mockReset().mockResolvedValue([{ deviceId: 'usb-mic', label: 'USB Microphone' }])
    voice.microphone.mockReset()
    voice.openMicrophoneSettings.mockReset()
    voice.listModels.mockResolvedValue({
      models,
      defaultAsrModelId: APPLE_ASR_MODEL_ID,
      defaultSpeechModelId: APPLE_TTS_MODEL_ID
    })
    voice.resolveTranscription
      .mockReset()
      .mockResolvedValue({ modelId: APPLE_ASR_MODEL_ID, status: { status: 'ready' } })
    voice.resolveSpeech.mockReset().mockResolvedValue({
      modelId: APPLE_TTS_MODEL_ID,
      voice: 'voice.exact',
      language: 'en-US',
      speed: 1,
      status: { status: 'ready' }
    })
    voice.listTranscriptionLocales.mockResolvedValue({ supported: ['en-US', 'zh-CN', 'ja-JP'], installed: ['en-US'] })
    voice.listVoices.mockResolvedValue([{ id: 'voice.exact', name: 'Exact Voice', language: 'en-US' }])
    voice.getModelStatus.mockReset().mockImplementation(async ({ modelId }) =>
      modelId === FUNASR_MODEL_ID
        ? {
            status:
              (
                { not_downloaded: 'not_installed', downloading: 'installing', error: 'failed' } as Record<
                  string,
                  string
                >
              )[voice.funAsrModel.status] ?? voice.funAsrModel.status,
            percent: voice.funAsrModel.percent
          }
        : { status: 'ready' }
    )
    voice.install.mockReturnValue({ sessionId: 'install', requestId: 'request', result: Promise.resolve() })
    voice.microphone.mockResolvedValue('granted')
    voice.openMicrophoneSettings.mockResolvedValue(undefined)
    voice.dictationStartScoped.mockReturnValue({ result: Promise.resolve(), cancel: vi.fn(async () => undefined) })
    voice.dictationStop.mockResolvedValue(undefined)
    voice.dictationTranscribe.mockResolvedValue(undefined)
    voice.dictationRetry.mockResolvedValue(undefined)
    voice.dictationDiscard.mockResolvedValue(undefined)
    voice.speechStart.mockResolvedValue({ status: 'started' })
    voice.speechStop.mockResolvedValue(undefined)
    voice.funAsrDownload.mockResolvedValue(true)
    voice.funAsrCancel.mockResolvedValue(undefined)
    voice.funAsrRemove.mockResolvedValue({ removed: true })
    voice.funAsrModel = { status: 'not_downloaded', percent: 0, isStatusResolved: true }
    voice.dictation = { phase: 'idle', elapsedMs: 0, recoveryAvailable: false }
    voice.speech = { phase: 'idle', progress: { completed: 0, total: 0 } }
    confirm.mockReset()
    vi.clearAllMocks()
  })

  it('shows effective defaults without persisting platform-specific choices', async () => {
    render(<VoiceSettings />)
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Recognition model' })).toHaveTextContent(
        'Automatic · Apple System Speech Recognition'
      )
    )
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Speech voice' })).toHaveTextContent('Recommended · Exact Voice')
    )
    expect(screen.getByRole('button', { name: 'Play preview' })).toBeEnabled()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.voice_id')).toBeNull()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.model_id')).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Speech model' })).not.toBeInTheDocument()
  })

  it('previews a localized sample without asking the user to type first', async () => {
    render(<VoiceSettings />)
    const play = screen.getByRole('button', { name: 'Play preview' })
    await waitFor(() => expect(play).toBeEnabled())
    await userEvent.setup().click(play)
    expect(voice.speechStart).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Hello, this is a preview of the voice used to read your responses.',
        trigger: 'manual'
      })
    )
    expect(screen.queryByRole('textbox', { name: 'Preview text' })).not.toBeInTheDocument()
  })

  it('allows an explicit custom sample through progressive disclosure', async () => {
    render(<VoiceSettings />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Use custom preview text' }))
    await user.type(screen.getByRole('textbox', { name: 'Preview text' }), 'Custom sample')
    await user.click(screen.getByRole('button', { name: 'Play preview' }))
    expect(voice.speechStart).toHaveBeenCalledWith(expect.objectContaining({ text: 'Custom sample' }))
  })

  it('keeps recognition resource management on the local models page', async () => {
    voice.resolveTranscription.mockResolvedValue({
      modelId: APPLE_ASR_MODEL_ID,
      status: { status: 'not_installed', reason: 'asset_required' }
    })
    render(<VoiceSettings />)
    expect(await screen.findByText('Speech resources must be installed for this language.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage voice resources' })).toHaveAttribute(
      'href',
      '/settings/local-models#system-voice-resources'
    )
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Recognition test transcript' })).not.toBeInTheDocument()
  })

  it('links downloadable recognition models to their own resource card', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', FUNASR_MODEL_ID)
    voice.resolveTranscription.mockResolvedValue({
      modelId: FUNASR_MODEL_ID,
      status: { status: 'not_installed', reason: 'model_required' }
    })
    render(<VoiceSettings />)
    expect(await screen.findByText('Download a speech recognition model in Local Models.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage voice resources' })).toHaveAttribute(
      'href',
      '/settings/local-models#voice-resources'
    )
    expect(screen.queryByRole('button', { name: /download model/i })).not.toBeInTheDocument()
  })

  it('selects a microphone without requesting permission or changing models', async () => {
    render(<VoiceSettings />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Microphone' }))
    await user.click(await screen.findByRole('option', { name: 'USB Microphone' }))
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.input.device_id')).toBe('usb-mic')
    expect(voice.testMicrophone).not.toHaveBeenCalled()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.model_id')).toBeNull()
  })

  it('starts an independent microphone test on demand even when recognition needs a download', async () => {
    const done = deferred<void>()
    voice.resolveTranscription.mockResolvedValue({
      modelId: APPLE_ASR_MODEL_ID,
      status: { status: 'not_installed', reason: 'asset_required' }
    })
    voice.testMicrophone.mockImplementation((_signal, _device, ready, level) => {
      ready([{ deviceId: 'usb', label: 'USB' }])
      level(30)
      return done.promise
    })
    render(<VoiceSettings />)
    expect(voice.testMicrophone).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /allow access/i })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Test microphone' }))
    expect(screen.getByRole('meter', { name: 'Input level' })).toHaveAttribute('value', '30')
    expect(screen.getByText('Speak to check the input level. No audio is saved.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop test' }))
    expect(voice.testMicrophone.mock.calls[0][0].aborted).toBe(true)
    await act(async () => done.resolve())
    expect(screen.getByRole('button', { name: 'Test microphone' })).toBeInTheDocument()
  })

  it('cancels a pending permission request when leaving the settings page', async () => {
    const done = deferred<void>()
    voice.testMicrophone.mockReturnValue(done.promise)
    const { unmount } = render(<VoiceSettings />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Test microphone' }))
    const [signal, , ready] = voice.testMicrophone.mock.calls[0]
    unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => {
      ready([])
      done.resolve()
    })
  })

  it('offers system settings recovery only after microphone permission is denied', async () => {
    voice.microphone.mockResolvedValue('not-determined')
    voice.testMicrophone.mockRejectedValue(new VoiceDomainError('microphone_permission'))
    render(<VoiceSettings />)
    expect(screen.queryByRole('button', { name: 'Open microphone settings' })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Test microphone' }))
    const settings = await screen.findByRole('button', { name: 'Open microphone settings' })
    await userEvent.setup().click(settings)
    expect(voice.openMicrophoneSettings).toHaveBeenCalledOnce()
  })

  it('preserves an unavailable explicit voice and blocks preview', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.speech.voice_id', 'removed')
    voice.resolveSpeech.mockResolvedValue({
      modelId: APPLE_TTS_MODEL_ID,
      voice: 'removed',
      status: { status: 'not_installed', reason: 'voice_unavailable' }
    })
    render(<VoiceSettings />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Speech voice' })).toHaveTextContent('unavailable'))
    expect(screen.getByRole('button', { name: 'Play preview' })).toBeDisabled()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.voice_id')).toBe('removed')
  })

  it('does not enable preview from a stale language resolution', async () => {
    const pending = deferred<any>()
    voice.resolveSpeech.mockReturnValueOnce(pending.promise).mockResolvedValue({
      modelId: APPLE_TTS_MODEL_ID,
      status: { status: 'not_installed', reason: 'voice_unavailable' }
    })
    const { rerender } = render(<VoiceSettings />)
    await waitFor(() => expect(voice.resolveSpeech).toHaveBeenCalled())
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.speech.language', 'ja-JP')
    rerender(<VoiceSettings />)
    await act(async () => pending.resolve({ modelId: APPLE_TTS_MODEL_ID, voice: 'old', status: { status: 'ready' } }))
    await screen.findByText('The selected system voice is unavailable.')
    expect(screen.getByRole('button', { name: 'Play preview' })).toBeDisabled()
  })

  it('returns to a recommended voice when the user changes language', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.voice.speech.voice_id': 'voice.exact',
      'feature.voice.speech.language': 'en-US'
    })
    voice.listVoices.mockResolvedValue([
      { id: 'voice.exact', name: 'Exact Voice', language: 'en-US' },
      { id: 'japanese', name: 'Japanese Voice', language: 'ja-JP' }
    ])
    const { rerender } = render(<VoiceSettings />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Speech voice' })).toHaveTextContent('Exact Voice'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Speech language' }))
    await user.click(screen.getByRole('option', { name: 'Japanese (Japan)' }))
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.voice_id')).toBe('')
    voice.resolveSpeech.mockResolvedValue({
      modelId: APPLE_TTS_MODEL_ID,
      voice: 'japanese',
      language: 'ja-JP',
      status: { status: 'ready' }
    })
    rerender(<VoiceSettings />)
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Speech voice' })).toHaveTextContent('Recommended · Japanese Voice')
    )
    expect(screen.getByRole('button', { name: 'Play preview' })).toBeEnabled()
  })

  it('keeps Stop available while playback is active even if configuration becomes unavailable', async () => {
    render(<VoiceSettings />)
    publishSpeech({ phase: 'playing', progress: { completed: 0, total: 1 } })
    const stop = screen.getByRole('button', { name: 'Stop' })
    expect(stop).toBeEnabled()
    await userEvent.setup().click(stop)
    expect(voice.speechStop).toHaveBeenCalledOnce()
  })

  it('does not show an older preview failure after a new preview has started', async () => {
    const old = deferred<any>()
    voice.speechStart.mockReturnValueOnce(old.promise).mockResolvedValue({ status: 'started' })
    render(<VoiceSettings />)
    const button = screen.getByRole('button', { name: 'Play preview' })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.setup().click(button)
    await userEvent.setup().click(button)
    await act(async () => old.reject(new VoiceDomainError('operation_failed')))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('replaces the full test text instead of inserting at a moved cursor', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    render(<VoiceSettings />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Test speech recognition' }))

    const record = await screen.findByRole('button', { name: /record test/i })
    const transcript = screen.getByRole('textbox', { name: /recognition test transcript/i })
    await waitFor(() => expect(record).toBeEnabled())
    await user.click(record)
    const target = voice.targetManager!.captureCurrent()!

    await user.type(transcript, 'Edited test text.')
    await user.keyboard('{Home}{ArrowRight}')
    act(() => {
      voice.targetManager!.insert(target, 'Current recording.')
    })
    expect(transcript).toHaveValue('Current recording.')
  })

  it('explains when no speech was detected and allows a new recording', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    voice.dictation = {
      phase: 'failed',
      elapsedMs: 2000,
      recoveryAvailable: false,
      retryAvailable: false,
      error: 'no_speech'
    }
    render(<VoiceSettings />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Test speech recognition' }))

    const recordingTest = within(screen.getByRole('region', { name: 'Test speech recognition' }))
    expect(await recordingTest.findByRole('alert')).toHaveTextContent(
      'No speech was detected. Check your microphone and record again.'
    )
    await waitFor(() => expect(screen.getByRole('button', { name: /record test/i })).toBeEnabled())
    expect(screen.queryByRole('button', { name: /^retry$/i })).not.toBeInTheDocument()
  })

  it('keeps recognition and playback errors beside their own test controls without hiding either', async () => {
    voice.dictation = { phase: 'failed', elapsedMs: 0, recoveryAvailable: false, error: 'no_speech' }
    voice.speech = { phase: 'failed', progress: { completed: 0, total: 0 }, error: 'timeout' }
    render(<VoiceSettings />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Test speech recognition' }))

    const recordingTest = within(screen.getByRole('region', { name: 'Test speech recognition' }))
    const playbackTest = within(screen.getByRole('group', { name: 'Play preview' }))
    expect(await recordingTest.findByRole('alert')).toHaveTextContent(/no speech was detected/i)
    expect(await playbackTest.findByRole('alert')).toHaveTextContent(/timed out/i)
    expect(screen.getAllByRole('alert')).toHaveLength(2)
  })

  it('reports a published preview failure once and clears it when playback recovers elsewhere', async () => {
    const starting = deferred<{ status: 'started' }>()
    voice.speechStart.mockReturnValueOnce(starting.promise)
    const { input, play, user } = await renderPreviewTest()

    await user.click(play)
    await act(async () => {
      publishSpeech({
        phase: 'failed',
        sourceLabel: 'preview',
        progress: { completed: 0, total: 1 },
        error: 'operation_failed'
      })
      starting.reject(new VoiceDomainError('operation_failed'))
    })

    const playbackTest = within(screen.getByRole('group', { name: 'Play preview' }))
    expect(await playbackTest.findByRole('alert')).toHaveTextContent(/operation failed/i)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(input).toHaveAccessibleDescription(/operation failed/i)

    publishSpeech({ phase: 'playing', sourceLabel: 'preview', progress: { completed: 0, total: 1 } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(input).not.toHaveAccessibleDescription()
  })

  it('keeps an unpublished preview failure beside its controls until the next preview action', async () => {
    const starting = deferred<{ status: 'started' }>()
    voice.speechStart.mockReturnValueOnce(starting.promise)
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    const { input, play, user } = await renderPreviewTest()

    await user.click(play)
    publishSpeech({ phase: 'playing', sourceLabel: 'message', progress: { completed: 0, total: 1 } })
    await act(async () => starting.reject(new Error('Preview preparation failed')))

    const playbackTest = within(screen.getByRole('group', { name: 'Play preview' }))
    expect(await playbackTest.findByRole('alert')).toHaveTextContent(/operation failed/i)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(input).toHaveAccessibleDescription(/operation failed/i)

    await user.click(screen.getByRole('button', { name: 'Test speech recognition' }))
    await user.click(screen.getByRole('button', { name: /record test/i }))
    expect(playbackTest.getByRole('alert')).toHaveTextContent(/operation failed/i)
    await user.click(screen.getByRole('button', { name: /^stop$/i }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports a preview stop cleanup failure once beside the preview controls', async () => {
    voice.speech = { phase: 'generating', sourceLabel: 'preview', progress: { completed: 0, total: 1 } }
    voice.speechStop.mockImplementationOnce(async () => {
      publishSpeech({
        phase: 'failed',
        sourceLabel: 'preview',
        progress: { completed: 0, total: 1 },
        error: 'operation_failed'
      })
      throw new VoiceDomainError('operation_failed')
    })
    const user = userEvent.setup()
    render(<VoiceSettings />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Test speech recognition' }))

    await user.click(screen.getByRole('button', { name: /^stop$/i }))

    const playbackTest = within(screen.getByRole('group', { name: 'Play preview' }))
    expect(await playbackTest.findByRole('alert')).toHaveTextContent(/operation failed/i)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('does not report an interrupted preview start as a failure', async () => {
    const starting = deferred<{ status: 'started' }>()
    voice.speechStart.mockReturnValueOnce(starting.promise)
    const { play, user } = await renderPreviewTest()

    await user.click(play)
    await act(async () => starting.reject(new VoiceDomainError('aborted')))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears the previous result when starting a new recording test', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    render(<VoiceSettings />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Test speech recognition' }))

    const record = await screen.findByRole('button', { name: /record test/i })
    const transcript = screen.getByRole('textbox', { name: /recognition test transcript/i })
    await waitFor(() => expect(record).toBeEnabled())
    await user.click(record)
    const target = voice.targetManager!.captureCurrent()!
    act(() => {
      voice.targetManager!.insert(target, 'Previous result.')
    })
    expect(transcript).toHaveValue('Previous result.')

    await user.click(record)

    expect(transcript).toHaveValue('')
  })

  it('persists the local-only disclosure before enabling auto-read and restores focus', async () => {
    confirm.mockResolvedValue(true)
    render(<VoiceSettings />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Test speech recognition' }))

    const toggle = await screen.findByRole('switch', { name: /automatically read/i })
    fireEvent.click(toggle)

    await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
    const focusOnClose = confirm.mock.calls[0][0].focusOnClose
    expect(focusOnClose).toBeTypeOf('function')
    focusOnClose()
    await waitFor(() => expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.auto_read.enabled')).toBe(true))
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.auto_read.disclosure_confirmed')).toBe(true)
    expect(toggle).toHaveFocus()
  })

  it('keeps recovery and retry states one-shot instead of starting a new recording', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    voice.dictation = { phase: 'recovery', elapsedMs: 0, recoveryAvailable: true }
    const view = render(<VoiceSettings />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Test speech recognition' }))

    expect(await screen.findByRole('button', { name: /record test/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /insert transcript/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /discard/i })).toBeEnabled()

    act(() => {
      voice.dictation = {
        phase: 'failed',
        elapsedMs: 0,
        recoveryAvailable: false,
        retryAvailable: true,
        error: 'transcription_failed'
      }
      voice.dictationListeners.forEach((listener) => listener())
    })
    expect(await screen.findByRole('button', { name: /retry/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /record test/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(voice.dictationRetry).toHaveBeenCalledOnce()
    view.unmount()
  })

  it('preserves an interrupted recording until the user chooses to transcribe or discard it', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    voice.dictation = { phase: 'recorded', elapsedMs: 12_000, recoveryAvailable: false }
    render(<VoiceSettings />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Test speech recognition' }))

    expect(await screen.findByRole('status', { name: /dictation status/i })).toHaveTextContent(
      i18n.t('settings.voice.dictation.phase.recorded')
    )
    const record = screen.getByRole('button', { name: /record test/i })
    await user.click(record)
    expect(record).toBeDisabled()
    expect(voice.dictationStartScoped).not.toHaveBeenCalled()
    expect(voice.dictationTranscribe).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: i18n.t('settings.voice.action.transcribe') }))
    expect(voice.dictationTranscribe).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: /discard/i }))
    expect(voice.dictationDiscard).toHaveBeenCalledOnce()
  })

  it('reports a saved-recording transcription failure without starting a new recording', async () => {
    const user = userEvent.setup()
    voice.dictation = { phase: 'recorded', elapsedMs: 12_000, recoveryAvailable: false }
    voice.dictationTranscribe.mockRejectedValueOnce(new Error('transcription unavailable'))
    render(<VoiceSettings />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Test speech recognition' }))

    await user.click(screen.getByRole('button', { name: i18n.t('settings.voice.action.transcribe') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/operation failed/i)
    expect(voice.dictationStartScoped).not.toHaveBeenCalled()
  })

  it.each([
    { status: 'unsupported' },
    { status: 'not_installed', reason: 'voice_unavailable' },
    { status: 'installing' },
    { status: 'failed', reason: 'operation_failed' }
  ])('does not start a TTS preview unless exact status is ready: $status', async (status) => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.voice.speech.model_id': APPLE_TTS_MODEL_ID,
      'feature.voice.speech.voice_id': 'voice.exact',
      'feature.voice.speech.language': 'en-US'
    })
    voice.resolveSpeech.mockResolvedValue({ modelId: APPLE_TTS_MODEL_ID, voice: 'voice.exact', status })
    render(<VoiceSettings />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Test speech recognition' }))

    await waitFor(() => expect(screen.getByRole('button', { name: /play preview/i })).toBeDisabled())
    expect(voice.speechStart).not.toHaveBeenCalled()
  })

  it('reports a failure when opening microphone settings is rejected', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    voice.microphone.mockResolvedValue('denied')
    voice.openMicrophoneSettings.mockRejectedValueOnce(new Error('settings unavailable'))
    render(<VoiceSettings />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Test speech recognition' }))

    await user.click(await screen.findByRole('button', { name: /open microphone settings/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/operation failed/i)
  })

  it('shows the live dictation phase and elapsed recording time', async () => {
    voice.dictation = { phase: 'recording', elapsedMs: 12_000, recoveryAvailable: false }
    render(<VoiceSettings />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Test speech recognition' }))

    expect(await screen.findByRole('status', { name: /dictation status/i })).toHaveTextContent(/recording.*12/i)
  })
})
