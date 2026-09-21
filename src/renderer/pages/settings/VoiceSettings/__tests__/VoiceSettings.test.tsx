import { MockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
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
    funAsrDownload: vi.fn(),
    funAsrCancel: vi.fn(),
    funAsrRemove: vi.fn(),
    funAsrModel: { status: 'not_downloaded', percent: 0, isStatusResolved: true } as any,
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

vi.mock('@renderer/hooks/useFunAsrModel', () => ({
  useFunAsrModel: () => ({
    ...voice.funAsrModel,
    download: voice.funAsrDownload,
    cancel: voice.funAsrCancel,
    remove: voice.funAsrRemove
  })
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
    voice.funAsrDownload.mockResolvedValue(true)
    voice.funAsrCancel.mockResolvedValue(undefined)
    voice.funAsrRemove.mockResolvedValue({ removed: true })
    voice.funAsrModel = { status: 'not_downloaded', percent: 0, isStatusResolved: true }
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

  it('downloads FunASR from Voice settings without reserving a Voice session', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', FUNASR_MODEL_ID)
    render(<VoiceSettings />)

    expect(await screen.findByText(/about 1 gb/i)).toHaveTextContent(/processed locally/i)
    expect(screen.getByText(/about 1 gb/i)).toHaveTextContent(/funaudiollm.*modelscope/i)
    expect(screen.getByText(/about 1 gb/i)).toHaveTextContent(/apache-2\.0/i)
    expect(screen.getByLabelText(/recognition language/i)).toBeDisabled()
    expect(screen.getByLabelText(/recognition language/i)).toHaveValue('Automatic detection')
    expect(voice.funAsrDownload).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: /download model/i }))
    await waitFor(() => expect(voice.funAsrDownload).toHaveBeenCalledOnce())
    expect(voice.install).not.toHaveBeenCalled()
    expect(voice.dictationStartScoped).not.toHaveBeenCalled()
  })

  it('does not rewrite the configured language when FunASR is only the recommended default', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.language', 'en-US')
    voice.listModels.mockResolvedValue({ models, defaultAsrModelId: FUNASR_MODEL_ID })
    render(<VoiceSettings />)

    const language = await screen.findByLabelText(/recognition language/i)
    await waitFor(() => expect(language).toBeDisabled())

    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.language')).toBe('en-US')
  })

  it('clears an explicit language when the user explicitly selects FunASR', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.voice.recognition.model_id': APPLE_ASR_MODEL_ID,
      'feature.voice.recognition.language': 'en-US'
    })
    render(<VoiceSettings />)

    await user.click(await screen.findByRole('button', { name: 'FunASR Nano' }))

    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.language')).toBe('')
    )
    const recognitionUpdates = MockUsePreference.useMultiplePreferences.mock.calls.flatMap(([keys], index) =>
      keys.modelId === 'feature.voice.recognition.model_id'
        ? MockUsePreference.useMultiplePreferences.mock.results[index].value[1].mock.calls.map(([updates]) => updates)
        : []
    )
    expect(recognitionUpdates).toContainEqual({ modelId: FUNASR_MODEL_ID, language: '' })
  })

  it('does not offer a FunASR lifecycle action until the model status is resolved', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', FUNASR_MODEL_ID)
    voice.funAsrModel = { status: 'not_downloaded', percent: 0, isStatusResolved: false }
    const view = render(<VoiceSettings />)

    expect(await screen.findByText(/about 1 gb/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /download model|retry download|cancel download|remove model/i })
    ).toBeNull()

    voice.funAsrModel = { status: 'not_downloaded', percent: 0, isStatusResolved: true }
    view.rerender(<VoiceSettings />)

    expect(await screen.findByRole('button', { name: /download model/i })).toBeEnabled()
  })

  it('keeps the FunASR lifecycle action focused and leaves Cancel enabled while download is pending', async () => {
    const user = userEvent.setup()
    const download = deferred<boolean>()
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', FUNASR_MODEL_ID)
    voice.funAsrDownload.mockReturnValue(download.promise)
    const view = render(<VoiceSettings />)

    const downloadButton = await screen.findByRole('button', { name: /download model/i })
    await user.click(downloadButton)
    expect(downloadButton).toHaveFocus()

    voice.funAsrModel = { status: 'downloading', percent: 15, isStatusResolved: true }
    view.rerender(<VoiceSettings />)

    const cancelButton = screen.getByRole('button', { name: /cancel download/i })
    expect(cancelButton).toBeEnabled()
    expect(cancelButton).toHaveFocus()

    await act(async () => {
      download.resolve(true)
      await download.promise
    })
    voice.funAsrModel = { status: 'ready', percent: 100, isStatusResolved: true }
    view.rerender(<VoiceSettings />)

    const removeButton = screen.getByRole('button', { name: /remove model/i })
    expect(removeButton).toHaveFocus()
    await user.click(removeButton)

    voice.funAsrModel = { status: 'not_downloaded', percent: 0, isStatusResolved: true }
    view.rerender(<VoiceSettings />)

    expect(screen.getByRole('button', { name: /download model/i })).toHaveFocus()
  })

  it('offers a stable retry after a failed FunASR download', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', FUNASR_MODEL_ID)
    voice.funAsrModel = { status: 'error', percent: 0, isStatusResolved: true }
    render(<VoiceSettings />)

    fireEvent.click(await screen.findByRole('button', { name: /retry download/i }))
    expect(voice.funAsrDownload).toHaveBeenCalledOnce()
  })

  it('shows the stable download error when an explicit FunASR download fails', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', FUNASR_MODEL_ID)
    voice.funAsrDownload.mockRejectedValue(new Error('private download details'))
    render(<VoiceSettings />)

    fireEvent.click(await screen.findByRole('button', { name: /download model/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/model download failed/i)
    expect(screen.getByRole('alert')).not.toHaveTextContent(/private download details/i)
  })

  it('does not offer a FunASR download on an unsupported native platform', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', FUNASR_MODEL_ID)
    voice.funAsrModel = { status: 'unsupported', percent: 0, isStatusResolved: true }
    render(<VoiceSettings />)

    expect(await screen.findByText(/not supported on this system/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /download model|retry download/i })).not.toBeInTheDocument()
  })

  it('shows FunASR progress and offers cancel or removal for the current lifecycle state', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', FUNASR_MODEL_ID)
    voice.funAsrModel = { status: 'downloading', percent: 42, isStatusResolved: true }
    const view = render(<VoiceSettings />)

    expect(await screen.findByText(/42%/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /cancel download/i }))
    expect(voice.funAsrCancel).toHaveBeenCalledOnce()

    voice.funAsrModel = { status: 'ready', percent: 100, isStatusResolved: true }
    view.rerender(<VoiceSettings />)
    fireEvent.click(await screen.findByRole('button', { name: /remove model/i }))
    expect(voice.funAsrRemove).toHaveBeenCalledOnce()
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
