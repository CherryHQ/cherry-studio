import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { APPLE_ASR_MODEL_ID, APPLE_TTS_MODEL_ID, FUNASR_MODEL_ID } from '@shared/ai/localVoice'

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
    listModels: vi.fn(),
    getModelStatus: vi.fn(),
    listVoices: vi.fn(),
    install: vi.fn(),
    microphone: vi.fn(),
    openMicrophoneSettings: vi.fn(),
    dictationStartScoped: vi.fn(),
    dictationStop: vi.fn(),
    dictationRetry: vi.fn(),
    dictationDiscard: vi.fn(),
    speechStart: vi.fn(),
    speechStop: vi.fn(),
    bind: vi.fn(() => vi.fn()),
    markCurrent: vi.fn(() => true)
  }
})

vi.mock('@renderer/services/voice', () => ({
  voiceService: {
    initialize: vi.fn(async () => undefined),
    listModels: voice.listModels,
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
  voiceTargetManager: { bind: voice.bind, markCurrent: voice.markCurrent }
}))

const confirm = vi.hoisted(() => vi.fn())
vi.mock('@renderer/services/popup', () => ({ popup: { confirm } }))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))

import VoiceSettings from '../VoiceSettings'

const models = [
  { id: APPLE_ASR_MODEL_ID, name: 'Apple System ASR' },
  { id: APPLE_TTS_MODEL_ID, name: 'Apple System TTS' },
  { id: FUNASR_MODEL_ID, name: 'FunASR Nano' }
]

describe('VoiceSettings', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    voice.microphone.mockReset()
    voice.openMicrophoneSettings.mockReset()
    voice.listModels.mockResolvedValue({ models })
    voice.listVoices.mockResolvedValue([{ id: 'voice.exact', name: 'Exact Voice', language: 'en-US' }])
    voice.getModelStatus.mockResolvedValue({ status: 'ready' })
    voice.install.mockReturnValue({ sessionId: 'install', requestId: 'request', result: Promise.resolve() })
    voice.microphone.mockResolvedValue('granted')
    voice.openMicrophoneSettings.mockResolvedValue(undefined)
    voice.dictationStartScoped.mockReturnValue({ result: Promise.resolve(), cancel: vi.fn(async () => undefined) })
    voice.dictationStop.mockResolvedValue(undefined)
    voice.dictationRetry.mockResolvedValue(undefined)
    voice.dictationDiscard.mockResolvedValue(undefined)
    voice.speechStart.mockResolvedValue({ status: 'started' })
    voice.speechStop.mockResolvedValue(undefined)
    voice.dictation = { phase: 'idle', elapsedMs: 0, recoveryAvailable: false }
    voice.speech = { phase: 'idle', progress: { completed: 0, total: 0 } }
    confirm.mockReset()
    vi.clearAllMocks()
  })

  it('keeps missing configuration discoverable', async () => {
    render(<VoiceSettings />)

    expect(await screen.findByRole('heading', { name: /voice/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/recognition model/i)).toHaveValue('')
    expect(screen.getByLabelText(/speech voice/i)).toHaveValue('')
    expect(screen.getByRole('button', { name: /record test/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /play preview/i })).toBeDisabled()
  })

  it('installs only the explicit Apple recognition asset', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.voice.recognition.model_id': APPLE_ASR_MODEL_ID,
      'feature.voice.recognition.language': 'en-US'
    })
    voice.getModelStatus.mockResolvedValue({ status: 'not_installed', reason: 'asset_required' })
    render(<VoiceSettings />)

    expect(await screen.findByText(/speech assets must be installed|Apple 语音资源/i)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /install/i }))
    await waitFor(() => expect(voice.install).toHaveBeenCalledWith({ language: 'en-US', source: 'settings' }))
  })

  it('uses the Main recommended ASR model without persisting it or installing assets', async () => {
    voice.listModels.mockResolvedValue({ models, defaultAsrModelId: APPLE_ASR_MODEL_ID })
    render(<VoiceSettings />)

    const record = await screen.findByRole('button', { name: /record test/i })
    await waitFor(() => expect(record).toBeEnabled())
    fireEvent.click(record)

    expect(voice.dictationStartScoped).toHaveBeenCalledWith()
    expect(screen.getByLabelText(/recognition model/i)).toHaveValue('')
    expect(MockUsePreferenceUtils.getAllPreferenceValues()).not.toHaveProperty('feature.voice.recognition.model_id')
    expect(voice.install).not.toHaveBeenCalled()
  })

  it('queries TTS status with the exact selected voice and language', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.voice.speech.model_id': APPLE_TTS_MODEL_ID,
      'feature.voice.speech.voice_id': 'voice.exact',
      'feature.voice.speech.language': 'en-US'
    })
    render(<VoiceSettings />)

    await waitFor(() =>
      expect(voice.getModelStatus).toHaveBeenCalledWith({
        modelId: APPLE_TTS_MODEL_ID,
        voice: 'voice.exact',
        language: 'en-US'
      })
    )
    expect(screen.getByTestId('speech-status')).toHaveTextContent(/ready/i)
  })

  it('never offers a download for the unverified FunASR license', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', FUNASR_MODEL_ID)
    voice.getModelStatus.mockResolvedValue({ status: 'failed', reason: 'license_unverified' })
    render(<VoiceSettings />)

    expect(await screen.findByText(/license/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /install/i })).not.toBeInTheDocument()
  })

  it('routes manual ASR and exact-voice TTS tests through the controllers', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.voice.recognition.model_id': APPLE_ASR_MODEL_ID,
      'feature.voice.recognition.language': 'en-US',
      'feature.voice.speech.model_id': APPLE_TTS_MODEL_ID,
      'feature.voice.speech.voice_id': 'voice.exact',
      'feature.voice.speech.language': 'en-US',
      'feature.voice.speech.speed': 1.25
    })
    render(<VoiceSettings />)

    fireEvent.click(await screen.findByRole('button', { name: /record test/i }))
    expect(voice.dictationStartScoped).toHaveBeenCalledWith()

    act(() => {
      voice.dictation = { phase: 'recording', elapsedMs: 1000, recoveryAvailable: false }
      voice.dictationListeners.forEach((listener) => listener())
    })
    fireEvent.click(await screen.findByRole('button', { name: /stop recording/i }))
    expect(voice.dictationStop).toHaveBeenCalledOnce()

    act(() => {
      voice.dictation = { phase: 'transcribing', elapsedMs: 1000, recoveryAvailable: false }
      voice.dictationListeners.forEach((listener) => listener())
    })
    expect(await screen.findByRole('button', { name: /record test/i })).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/preview text/i), { target: { value: 'Read this exactly' } })
    fireEvent.click(screen.getByRole('button', { name: /play preview/i }))
    expect(voice.speechStart).toHaveBeenCalledWith({
      text: 'Read this exactly',
      trigger: 'manual',
      sourceLabel: 'preview',
      sourceEntityId: 'voice-settings'
    })
  })

  it('persists the local-only disclosure before enabling auto-read and restores focus', async () => {
    confirm.mockResolvedValue(true)
    render(<VoiceSettings />)

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

  it('does not replace an explicit unknown ASR model with the recommended default', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', 'unknown-local-model')
    voice.listModels.mockResolvedValue({ models, defaultAsrModelId: APPLE_ASR_MODEL_ID })
    render(<VoiceSettings />)

    expect(await screen.findByText(/not supported/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /record test/i })).toBeDisabled()
    expect(voice.getModelStatus).not.toHaveBeenCalledWith(expect.objectContaining({ modelId: APPLE_ASR_MODEL_ID }))
  })

  it('keeps recovery and retry states one-shot instead of starting a new recording', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    voice.dictation = { phase: 'recovery', elapsedMs: 0, recoveryAvailable: true }
    const view = render(<VoiceSettings />)

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
    voice.getModelStatus.mockResolvedValue(status)
    render(<VoiceSettings />)

    fireEvent.change(await screen.findByLabelText(/preview text/i), { target: { value: 'Do not synthesize' } })
    await waitFor(() => expect(screen.getByRole('button', { name: /play preview/i })).toBeDisabled())
    expect(voice.speechStart).not.toHaveBeenCalled()
  })

  it('keeps Stop available while TTS is busy regardless of the latest model status', async () => {
    voice.speech = { phase: 'generating', sourceLabel: 'preview', progress: { completed: 0, total: 1 } }
    voice.getModelStatus.mockResolvedValue({ status: 'failed', reason: 'voice_unavailable' })
    render(<VoiceSettings />)

    const stop = await screen.findByRole('button', { name: /^stop$/i })
    expect(stop).toBeEnabled()
    fireEvent.click(stop)
    expect(voice.speechStop).toHaveBeenCalledOnce()
  })

  it('refreshes microphone permission after a permission failure and prevents another recording', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    voice.microphone.mockResolvedValueOnce('granted').mockResolvedValueOnce('denied')
    render(<VoiceSettings />)
    await waitFor(() => expect(voice.microphone).toHaveBeenCalledOnce())

    act(() => {
      voice.dictation = {
        phase: 'failed',
        elapsedMs: 0,
        recoveryAvailable: false,
        error: 'microphone_permission'
      }
      voice.dictationListeners.forEach((listener) => listener())
    })

    expect(await screen.findByRole('button', { name: /open microphone settings/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /record test/i })).toBeDisabled()
  })

  it('does not request recording while microphone status is pending or unknown', async () => {
    const user = userEvent.setup()
    const microphone = deferred<'unknown'>()
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    voice.microphone.mockReturnValue(microphone.promise)
    render(<VoiceSettings />)

    const record = await screen.findByRole('button', { name: /record test/i })
    expect(record).toBeDisabled()
    await user.click(record)
    expect(voice.dictationStartScoped).not.toHaveBeenCalled()

    microphone.resolve('unknown')
    await waitFor(() => expect(voice.microphone).toHaveBeenCalledOnce())
    expect(record).toBeDisabled()
    await user.click(record)
    expect(voice.dictationStartScoped).not.toHaveBeenCalled()
  })

  it('allows the first OS permission prompt when microphone status is not determined', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    voice.microphone.mockResolvedValue('not-determined')
    render(<VoiceSettings />)

    const record = await screen.findByRole('button', { name: /record test/i })
    await waitFor(() => expect(record).toBeEnabled())
    await user.click(record)
    expect(voice.dictationStartScoped).toHaveBeenCalledOnce()
  })

  it('locks recording immediately when permission failure refresh is pending and cleans up its focus listener', async () => {
    const user = userEvent.setup()
    const refresh = deferred<'unknown'>()
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    const view = render(<VoiceSettings />)
    const record = await screen.findByRole('button', { name: /record test/i })
    await waitFor(() => expect(record).toBeEnabled())
    voice.microphone.mockReturnValueOnce(refresh.promise)

    act(() => {
      voice.dictation = {
        phase: 'failed',
        elapsedMs: 0,
        recoveryAvailable: false,
        error: 'microphone_permission'
      }
      voice.dictationListeners.forEach((listener) => listener())
    })

    expect(record).toBeDisabled()
    await user.click(record)
    expect(voice.dictationStartScoped).not.toHaveBeenCalled()

    refresh.resolve('unknown')
    await act(async () => refresh.promise)
    expect(record).toBeDisabled()
    const statusChecks = voice.microphone.mock.calls.length
    view.unmount()
    window.dispatchEvent(new Event('focus'))
    expect(voice.microphone).toHaveBeenCalledTimes(statusChecks)
  })

  it('rechecks permission on focus and cancels only its failed run after permission is granted', async () => {
    const cancelFailedRun = vi.fn(async () => {
      voice.dictation = { phase: 'idle', elapsedMs: 0, recoveryAvailable: false }
      voice.dictationListeners.forEach((listener) => listener())
    })
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    voice.microphone.mockResolvedValueOnce('granted').mockResolvedValueOnce('denied').mockResolvedValueOnce('granted')
    voice.dictationStartScoped.mockReturnValueOnce({ result: Promise.resolve(), cancel: cancelFailedRun })
    render(<VoiceSettings />)
    const record = await screen.findByRole('button', { name: /record test/i })
    await waitFor(() => expect(record).toBeEnabled())
    fireEvent.click(record)

    act(() => {
      voice.dictation = {
        phase: 'failed',
        elapsedMs: 0,
        recoveryAvailable: false,
        error: 'microphone_permission'
      }
      voice.dictationListeners.forEach((listener) => listener())
    })
    expect(await screen.findByRole('button', { name: /open microphone settings/i })).toBeEnabled()
    expect(record).toBeDisabled()

    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(cancelFailedRun).toHaveBeenCalledOnce())
    expect(voice.dictationDiscard).not.toHaveBeenCalled()
    expect(record).toBeEnabled()
    expect(voice.dictationStartScoped).toHaveBeenCalledOnce()

    const statusChecks = voice.microphone.mock.calls.length
    window.dispatchEvent(new Event('focus'))
    expect(voice.microphone).toHaveBeenCalledTimes(statusChecks)
  })

  it('reports a failure when opening microphone settings is rejected', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    voice.microphone.mockResolvedValue('denied')
    voice.openMicrophoneSettings.mockRejectedValueOnce(new Error('settings unavailable'))
    render(<VoiceSettings />)

    await user.click(await screen.findByRole('button', { name: /open microphone settings/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/operation failed/i)
  })

  it('shows the live dictation phase and elapsed recording time', async () => {
    voice.dictation = { phase: 'recording', elapsedMs: 12_000, recoveryAvailable: false }
    render(<VoiceSettings />)

    expect(await screen.findByRole('status', { name: /dictation status/i })).toHaveTextContent(/recording.*12/i)
  })

  it('shows installing status while an Apple asset installation is pending', async () => {
    const install = deferred<void>()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.voice.recognition.model_id': APPLE_ASR_MODEL_ID,
      'feature.voice.recognition.language': 'en-US'
    })
    voice.getModelStatus.mockResolvedValue({ status: 'not_installed', reason: 'asset_required' })
    voice.install.mockReturnValue({ sessionId: 'install', requestId: 'request', result: install.promise })
    render(<VoiceSettings />)

    fireEvent.click(await screen.findByRole('button', { name: /install/i }))
    expect(await screen.findByText(/^installing$/i)).toBeInTheDocument()
    install.resolve()
    await waitFor(() => expect(screen.queryByText(/^installing$/i)).not.toBeInTheDocument())
  })

  it('catches preference write failures instead of leaking an unhandled rejection', async () => {
    MockUsePreferenceUtils.mockPreferenceError(
      'feature.voice.auto_read.disclosure_confirmed',
      new Error('preference unavailable')
    )
    confirm.mockResolvedValue(true)
    render(<VoiceSettings />)

    fireEvent.click(await screen.findByRole('switch', { name: /automatically read/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/operation failed/i)
  })

  it('normalizes the automatic language sentinel to an empty preference and omits it from requests', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.voice.recognition.model_id': APPLE_ASR_MODEL_ID,
      'feature.voice.recognition.language': ''
    })
    render(<VoiceSettings />)

    await waitFor(() => expect(voice.getModelStatus).toHaveBeenCalledWith({ modelId: APPLE_ASR_MODEL_ID }))
    const language = screen.getByLabelText(/recognition language/i)
    expect(language).toHaveValue('')
    fireEvent.change(language, { target: { value: 'auto' } })
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.language')).toBe('')
    )
    fireEvent.click(screen.getByRole('button', { name: /record test/i }))
    expect(voice.dictationStartScoped).toHaveBeenCalledWith()
  })

  it('keeps the current scoped dictation run after its target unmounts', async () => {
    const first = deferred<void>()
    const firstCancel = vi.fn(async () => undefined)
    const second = deferred<void>()
    const secondCancel = vi.fn(async () => undefined)
    voice.dictationStartScoped
      .mockReturnValueOnce({ result: first.promise, cancel: firstCancel })
      .mockReturnValueOnce({ result: second.promise, cancel: secondCancel })
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    const view = render(<VoiceSettings />)

    const record = await screen.findByRole('button', { name: /record test/i })
    await waitFor(() => expect(record).toBeEnabled())
    fireEvent.click(record)
    fireEvent.click(record)
    first.resolve()
    await act(async () => first.promise)
    view.unmount()

    expect(firstCancel).not.toHaveBeenCalled()
    expect(secondCancel).not.toHaveBeenCalled()
  })
})
