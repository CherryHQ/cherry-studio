import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { Activity } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import { type SpeechPlaybackSnapshot, VoiceDomainError } from '@renderer/services/voice'
import { SpeechPlaybackService } from '@renderer/services/voice/SpeechPlaybackService'
import { VoiceService } from '@renderer/services/voice/VoiceService'
import { APPLE_ASR_MODEL_ID, APPLE_TTS_MODEL_ID, FUNASR_MODEL_ID, VoiceResourceOperation } from '@shared/ai/localVoice'
import {
  LOCAL_MODEL_BUNDLE_BY_CAPABILITY,
  LOCAL_MODEL_STATUS_CACHE_KEY,
  type LocalModelStatusSnapshot
} from '@shared/data/presets/localModel'
import type { VoicePlaybackState, VoiceSessionEvent } from '@shared/ipc/schemas/voice'

vi.unmock('@cherrystudio/ui')
vi.unmock('@data/hooks/useCache')

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
  const speech = { phase: 'idle', progress: { completed: 0, total: 0 } } as any
  return {
    speech,
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
    openSystemVoiceSettings: vi.fn(),
    speechStart: vi.fn(),
    speechStop: vi.fn(),
    funAsrDownload: vi.fn(),
    funAsrCancel: vi.fn(),
    funAsrRemove: vi.fn(),
    funAsrModel: { status: 'not_downloaded', percent: 0, isStatusResolved: true } as any
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
    openSystemVoiceSettings: voice.openSystemVoiceSettings,
    openMicrophoneSettings: voice.openMicrophoneSettings
  },
  speechPlaybackService: {
    subscribe: (listener: () => void) => {
      voice.speechListeners.add(listener)
      return () => voice.speechListeners.delete(listener)
    },
    getSnapshot: () => voice.speech,
    start: voice.speechStart,
    stop: voice.speechStop
  }
}))

const confirm = vi.hoisted(() => vi.fn())
vi.mock('@renderer/services/popup', () => ({ popup: { confirm } }))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))

const navigate = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

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

function publishAsrInstallation(snapshot: LocalModelStatusSnapshot) {
  voice.funAsrModel = snapshot
  act(() => {
    cacheService.setShared(LOCAL_MODEL_STATUS_CACHE_KEY, {
      ...cacheService.getShared(LOCAL_MODEL_STATUS_CACHE_KEY),
      [LOCAL_MODEL_BUNDLE_BY_CAPABILITY.asr]: snapshot
    })
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
  const play = screen.getByRole('button', { name: /preview voice/i })
  await waitFor(() => expect(play).toBeEnabled())
  return { play, user }
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
    vi.restoreAllMocks()
    await i18n.changeLanguage('en-US')
    MockUsePreferenceUtils.resetMocks()
    MockCacheUtils.resetMocks()
    voice.enumerateMicrophones.mockReset().mockResolvedValue([{ deviceId: 'usb-mic', label: 'USB Microphone' }])
    voice.testMicrophone.mockReset().mockResolvedValue([{ deviceId: 'usb-mic', label: 'USB Microphone' }])
    voice.microphone.mockReset()
    voice.openMicrophoneSettings.mockReset()
    voice.openSystemVoiceSettings.mockReset().mockResolvedValue(undefined)
    voice.install.mockReset()
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
    voice.speechStart.mockResolvedValue({ status: 'started' })
    voice.speechStop.mockResolvedValue(undefined)
    voice.funAsrDownload.mockResolvedValue(true)
    voice.funAsrCancel.mockResolvedValue(undefined)
    voice.funAsrRemove.mockResolvedValue({ removed: true })
    voice.funAsrModel = { status: 'not_downloaded', percent: 0, isStatusResolved: true }
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
      expect(screen.getByRole('combobox', { name: 'Speech voice' })).toHaveTextContent('Language default · Exact Voice')
    )
    expect(screen.getByRole('button', { name: 'Preview voice' })).toBeEnabled()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.voice_id')).toBeNull()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.model_id')).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Speech model' })).not.toBeInTheDocument()
  })

  it('keeps the language default distinct from an explicit voice without locking the interface language', async () => {
    voice.listVoices.mockResolvedValue([
      { id: 'voice.exact', name: 'Exact Voice', language: 'en-US' },
      { id: 'eddy', name: 'Eddy', language: 'en-US' }
    ])
    voice.resolveSpeech.mockImplementation(async ({ voice: selected }) => ({
      modelId: APPLE_TTS_MODEL_ID,
      voice: selected ?? 'voice.exact',
      language: 'en-US',
      speed: 1,
      status: { status: 'ready' }
    }))
    const user = userEvent.setup()
    const { rerender } = render(<VoiceSettings />)
    const select = screen.getByRole('combobox', { name: 'Speech voice' })
    await waitFor(() => expect(select).toHaveTextContent('Language default · Exact Voice'))
    await user.click(select)
    await user.click(screen.getByRole('option', { name: 'Eddy' }))
    rerender(<VoiceSettings />)
    await waitFor(() => expect(select).toHaveTextContent('Eddy'))
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.language')).toBeNull()
    await user.click(select)
    const automatic = await screen.findByRole('option', { name: 'Language default · Exact Voice' })
    await user.click(automatic)
    rerender(<VoiceSettings />)
    await waitFor(() => expect(select).toHaveTextContent('Language default · Exact Voice'))
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.voice_id')).toBe('')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.language')).toBeNull()
  })

  it.each(['configuration', 'voices'])('ends default loading when %s discovery fails', async (stage) => {
    if (stage === 'configuration') voice.resolveSpeech.mockRejectedValue(new VoiceDomainError('operation_failed'))
    else voice.listVoices.mockRejectedValue(new VoiceDomainError('operation_failed'))
    render(<VoiceSettings />)
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Speech voice' })).toHaveTextContent(/unavailable/i)
    )
    expect(screen.getByRole('combobox', { name: 'Speech voice' })).not.toHaveTextContent(/loading/i)
    if (stage === 'configuration') expect(screen.getByRole('button', { name: 'Preview voice' })).toBeDisabled()
  })

  it('previews a localized sample without asking the user to type first', async () => {
    render(<VoiceSettings />)
    const play = screen.getByRole('button', { name: 'Preview voice' })
    await waitFor(() => expect(play).toBeEnabled())
    await userEvent.setup().click(play)
    expect(voice.speechStart).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Hello, this is a preview of the voice used to read your responses.',
        trigger: 'manual'
      })
    )
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use custom preview text' })).not.toBeInTheDocument()
  })

  it('loads an initially absent speech-language catalog without changing the interface language', async () => {
    expect(i18n.hasResourceBundle('de-DE', 'translation')).toBe(false)
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.voice.speech.model_id': APPLE_TTS_MODEL_ID,
      'feature.voice.speech.language': 'de-DE'
    })
    voice.resolveSpeech.mockResolvedValue({
      modelId: APPLE_TTS_MODEL_ID,
      voice: 'german',
      language: 'de-DE',
      speed: 1,
      status: { status: 'ready' }
    })
    voice.listVoices.mockResolvedValue([{ id: 'german', name: 'German Voice', language: 'de-DE' }])
    render(<VoiceSettings />)
    const play = screen.getByRole('button', { name: 'Preview voice' })
    await waitFor(() => expect(play).toBeEnabled())
    await userEvent.setup().click(play)
    await waitFor(() =>
      expect(voice.speechStart).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Hallo, dies ist eine Vorschau der Stimme, die Ihre Antworten vorliest.'
        })
      )
    )
    expect(i18n.language).toBe('en-US')
  })

  it.each([
    ['fr-CA', 'Bonjour, voici un aperçu de la voix utilisée pour lire vos réponses.'],
    ['pt-BR', 'Olá, esta é uma amostra da voz utilizada para ler as suas respostas.']
  ])(
    'previews %s from the available same-language catalog without changing the selected voice',
    async (language, sample) => {
      MockUsePreferenceUtils.setMultiplePreferenceValues({
        'feature.voice.speech.model_id': APPLE_TTS_MODEL_ID,
        'feature.voice.speech.voice_id': 'voice.regional',
        'feature.voice.speech.language': language
      })
      voice.resolveSpeech.mockResolvedValue({
        modelId: APPLE_TTS_MODEL_ID,
        voice: 'voice.regional',
        language,
        speed: 1,
        status: { status: 'ready' }
      })
      voice.listVoices.mockResolvedValue([{ id: 'voice.regional', name: 'Regional Voice', language }])
      render(<VoiceSettings />)
      const play = screen.getByRole('button', { name: 'Preview voice' })
      await waitFor(() => expect(play).toBeEnabled())
      await userEvent.setup().click(play)
      await waitFor(() =>
        expect(voice.speechStart).toHaveBeenCalledWith(expect.objectContaining({ text: sample, trigger: 'manual' }))
      )
      expect(i18n.language).toBe('en-US')
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.language')).toBe(language)
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.voice_id')).toBe('voice.regional')
    }
  )

  it.each(['stop', 'unmount', 'preference'])('discards a pending preview catalog after %s', async (action) => {
    const loading = deferred<any>()
    const load = vi.spyOn(i18n, 'loadLanguages').mockReturnValueOnce(loading.promise)
    const { unmount, rerender } = render(<VoiceSettings />)
    const play = screen.getByRole('button', { name: 'Preview voice' })
    await waitFor(() => expect(play).toBeEnabled())
    const user = userEvent.setup()
    await user.click(play)
    if (action === 'stop') await user.click(screen.getByRole('button', { name: 'Stop' }))
    else if (action === 'unmount') unmount()
    else {
      MockUsePreferenceUtils.setPreferenceValue('feature.voice.speech.speed', 1.5)
      rerender(<VoiceSettings />)
    }
    await act(async () => loading.resolve(i18n.t))
    expect(voice.speechStart).not.toHaveBeenCalled()
    load.mockRestore()
  })

  it('opens model downloads from the recognition menu without changing the selected engine', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    render(<VoiceSettings />)
    const user = userEvent.setup()
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Recognition model' })).toHaveTextContent('Apple System')
    )
    expect(screen.queryByRole('link', { name: 'Download recognition models' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Test speech recognition' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Recognition model' }))
    await waitFor(() => expect(screen.getByRole('option', { name: /FunASR Nano.*Download/ })).toBeEnabled())
    await user.click(screen.getByRole('option', { name: /FunASR Nano.*Download/ }))
    expect(navigate).toHaveBeenCalledWith({ to: '/settings/local-models', hash: 'voice-resources' })
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.model_id')).toBe(APPLE_ASR_MODEL_ID)
    expect(voice.funAsrDownload).not.toHaveBeenCalled()
  })

  it('selects FunASR when its download completes while the recognition menu stays open', async () => {
    publishAsrInstallation({ status: 'downloading', percent: 25 })
    voice.resolveTranscription.mockImplementation(async ({ modelId }) => ({
      modelId: modelId || APPLE_ASR_MODEL_ID,
      status: { status: 'ready' }
    }))
    render(<VoiceSettings />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Recognition model' }))
    expect(await screen.findByRole('option', { name: /FunASR Nano Downloading/ })).toBeEnabled()
    voice.getModelStatus.mockClear()
    voice.resolveTranscription.mockClear()
    publishAsrInstallation({ status: 'downloading', percent: 75 })
    act(() => {
      cacheService.setShared(LOCAL_MODEL_STATUS_CACHE_KEY, {
        ...cacheService.getShared(LOCAL_MODEL_STATUS_CACHE_KEY),
        [LOCAL_MODEL_BUNDLE_BY_CAPABILITY.ocr]: { status: 'ready', percent: 100 }
      })
    })
    expect(voice.getModelStatus).not.toHaveBeenCalled()
    expect(voice.resolveTranscription).not.toHaveBeenCalled()

    publishAsrInstallation({ status: 'ready', percent: 100 })
    const option = await screen.findByRole('option', { name: 'FunASR Nano' })
    await waitFor(() => expect(option).toBeEnabled())
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.model_id')).toBeNull()
    await user.click(option)
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.model_id')).toBe(FUNASR_MODEL_ID)
    )
    expect(navigate).not.toHaveBeenCalled()
  })

  it.each([null, FUNASR_MODEL_ID])('refreshes the effective recognition status for preference %s', async (modelId) => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', modelId)
    publishAsrInstallation({ status: 'not_downloaded', percent: 0 })
    voice.resolveTranscription.mockResolvedValue({
      modelId: FUNASR_MODEL_ID,
      status: { status: 'not_installed', reason: 'model_required' }
    })
    render(<VoiceSettings />)
    const status = await screen.findByText('Download a speech recognition model in Local Models.')

    voice.resolveTranscription.mockResolvedValue({ modelId: FUNASR_MODEL_ID, status: { status: 'ready' } })
    publishAsrInstallation({ status: 'ready', percent: 100 })

    await waitFor(() => expect(status).toHaveTextContent('Ready'))
    expect(screen.getByRole('combobox', { name: 'Recognition model' })).toHaveTextContent('FunASR Nano')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.model_id')).toBe(modelId)
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.language')).toBeNull()
  })

  it.each(['downloading', 'ready'] as const)(
    'offers downloading again after %s becomes unavailable',
    async (initialStatus) => {
      MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', FUNASR_MODEL_ID)
      publishAsrInstallation({ status: initialStatus, percent: 100 })
      voice.resolveTranscription.mockResolvedValue({ modelId: FUNASR_MODEL_ID, status: { status: 'ready' } })
      render(<VoiceSettings />)
      const user = userEvent.setup()
      await user.click(screen.getByRole('combobox', { name: 'Recognition model' }))
      await screen.findByRole('option', { name: initialStatus === 'ready' ? 'FunASR Nano' : /FunASR Nano Downloading/ })

      voice.resolveTranscription.mockResolvedValue({
        modelId: FUNASR_MODEL_ID,
        status: { status: 'not_installed', reason: 'model_required' }
      })
      publishAsrInstallation({ status: 'not_downloaded', percent: 0 })
      await user.click(await screen.findByRole('option', { name: 'FunASR Nano Download' }))

      expect(navigate).toHaveBeenCalledWith({ to: '/settings/local-models', hash: 'voice-resources' })
      expect(await screen.findByText('Download a speech recognition model in Local Models.')).toBeInTheDocument()
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.model_id')).toBe(FUNASR_MODEL_ID)
    }
  )

  it('ignores status responses from before the model finished downloading', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', FUNASR_MODEL_ID)
    publishAsrInstallation({ status: 'not_downloaded', percent: 0 })
    voice.resolveTranscription.mockResolvedValue({
      modelId: FUNASR_MODEL_ID,
      status: { status: 'not_installed', reason: 'model_required' }
    })
    render(<VoiceSettings />)
    const status = await screen.findByText('Download a speech recognition model in Local Models.')
    const oldModelStatus = deferred<Awaited<ReturnType<VoiceService['getModelStatus']>>>()
    const oldConfiguration = deferred<Awaited<ReturnType<VoiceService['resolveTranscriptionConfiguration']>>>()
    voice.getModelStatus.mockReturnValueOnce(oldModelStatus.promise)
    voice.resolveTranscription.mockReturnValueOnce(oldConfiguration.promise)
    publishAsrInstallation({ status: 'downloading', percent: 25 })
    await waitFor(() => expect(status).toHaveTextContent('Loading'))

    voice.resolveTranscription.mockResolvedValue({ modelId: FUNASR_MODEL_ID, status: { status: 'ready' } })
    publishAsrInstallation({ status: 'ready', percent: 100 })
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Recognition model' }))
    expect(await screen.findByRole('option', { name: 'FunASR Nano' })).toBeEnabled()
    await act(async () => {
      oldModelStatus.resolve({ status: 'installing' })
      oldConfiguration.resolve({ modelId: FUNASR_MODEL_ID, status: { status: 'installing' } })
    })

    await waitFor(() => expect(status).toHaveTextContent('Ready'))
    expect(screen.getByRole('option', { name: 'FunASR Nano' })).toBeEnabled()
    expect(screen.queryByRole('option', { name: /FunASR Nano.*Download/ })).not.toBeInTheDocument()
  })

  it('lets an already-selected missing FunASR model open its download page again', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', FUNASR_MODEL_ID)
    voice.resolveTranscription.mockResolvedValue({
      modelId: FUNASR_MODEL_ID,
      status: { status: 'not_installed', reason: 'model_required' }
    })
    render(<VoiceSettings />)
    const user = userEvent.setup()
    const model = screen.getByRole('combobox', { name: 'Recognition model' })
    await waitFor(() => expect(model).toHaveTextContent('FunASR Nano'))
    await user.click(model)
    await user.click(await screen.findByRole('option', { name: /FunASR Nano.*Download/ }))
    expect(navigate).toHaveBeenCalledWith({ to: '/settings/local-models', hash: 'voice-resources' })
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.model_id')).toBe(FUNASR_MODEL_ID)
  })

  it('installs the current interface language only when its download option is selected', async () => {
    const user = userEvent.setup()
    const installation = deferred<void>()
    voice.install.mockReturnValue({ result: installation.promise })
    voice.listTranscriptionLocales.mockResolvedValue({ supported: ['en-US', 'zh-CN'], installed: [] })
    voice.resolveTranscription.mockResolvedValue({
      modelId: APPLE_ASR_MODEL_ID,
      status: { status: 'not_installed', reason: 'asset_required' }
    })
    render(<VoiceSettings />)
    expect(await screen.findByText('Speech resources must be installed for this language.')).toBeInTheDocument()
    expect(voice.install).not.toHaveBeenCalled()
    const language = screen.getByRole('combobox', { name: 'Recognition language' })
    await user.click(language)
    await user.click(screen.getByRole('option', { name: /Follow interface.*Download/ }))
    await waitFor(() =>
      expect(voice.install).toHaveBeenCalledWith({ modelId: APPLE_ASR_MODEL_ID, language: 'en-US', source: 'settings' })
    )
    expect(language).toBeDisabled()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.language')).toBe('')
    expect(screen.getByRole('combobox', { name: 'Recognition model' })).toBeDisabled()
    voice.listTranscriptionLocales.mockResolvedValue({ supported: ['en-US', 'zh-CN'], installed: ['en-US'] })
    voice.resolveTranscription.mockResolvedValue({ modelId: APPLE_ASR_MODEL_ID, status: { status: 'ready' } })
    await act(async () => installation.resolve())
    await waitFor(() => expect(language).toBeEnabled())
    await user.click(language)
    expect(screen.getByRole('option', { name: /Follow interface/ })).not.toHaveTextContent('Download')
  })

  it.each(['hidden', 'visible'] as const)(
    'clears installation state when Settings is %s after switching tabs',
    async (completionVisibility) => {
      const user = userEvent.setup()
      const installation = deferred<void>()
      voice.install.mockReturnValueOnce({ result: installation.promise })
      const view = render(
        <Activity mode="visible">
          <VoiceSettings />
        </Activity>
      )
      const language = await screen.findByRole('combobox', { name: 'Recognition language' })
      await waitFor(() => expect(language).toBeEnabled())
      await user.click(language)
      await user.click(screen.getByRole('option', { name: /Chinese.*Download/ }))
      await waitFor(() =>
        expect(voice.install).toHaveBeenCalledWith({
          modelId: APPLE_ASR_MODEL_ID,
          language: 'zh-CN',
          source: 'settings'
        })
      )

      view.rerender(
        <Activity mode="hidden">
          <VoiceSettings />
        </Activity>
      )
      if (completionVisibility === 'visible') {
        view.rerender(
          <Activity mode="visible">
            <VoiceSettings />
          </Activity>
        )
        expect(screen.getByRole('combobox', { name: 'Recognition language' })).toBeDisabled()
      }
      voice.listTranscriptionLocales.mockResolvedValue({ supported: ['en-US', 'zh-CN'], installed: ['en-US', 'zh-CN'] })
      await act(async () => installation.resolve())
      view.rerender(
        <Activity mode="visible">
          <VoiceSettings />
        </Activity>
      )

      await waitFor(() => expect(screen.getByRole('combobox', { name: 'Recognition language' })).toBeEnabled())
      expect(screen.getByRole('combobox', { name: 'Recognition model' })).toBeEnabled()
      await user.click(screen.getByRole('combobox', { name: 'Recognition language' }))
      expect(screen.getByRole('option', { name: /Chinese/ })).not.toHaveTextContent('Download')
      await user.click(screen.getByRole('option', { name: 'English (United States)' }))
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.language')).toBe('en-US')
    }
  )

  it('waits for an in-flight recognition inspection before installing a newly selected locale', async () => {
    const user = userEvent.setup()
    const inspection = deferred<void>()
    const persistence = deferred<void>()
    const originalPreferences = vi.mocked(useMultiplePreferences).getMockImplementation()
    vi.mocked(useMultiplePreferences).mockImplementation((keys, options) => {
      const [values, setValues] = originalPreferences!(keys, options)
      return [
        values,
        async (updates) => {
          const write = setValues(updates)
          await persistence.promise
          await write
        }
      ]
    })
    voice.resolveTranscription.mockImplementation(() =>
      inspection.promise.then(() => ({ modelId: APPLE_ASR_MODEL_ID, status: { status: 'ready' as const } }))
    )

    try {
      render(<VoiceSettings />)
      const language = screen.getByRole('combobox', { name: 'Recognition language' })
      await waitFor(() => expect(language).toBeEnabled())
      await waitFor(() => expect(voice.resolveTranscription).toHaveBeenCalled())
      const inspectionsBeforeSelection = voice.resolveTranscription.mock.calls.length

      await user.click(language)
      const selecting = user.click(screen.getByRole('option', { name: /Chinese.*Download/ }))
      await waitFor(() =>
        expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.language')).toBe('zh-CN')
      )
      await act(async () => {
        await Promise.resolve()
      })

      expect(voice.resolveTranscription).toHaveBeenCalledTimes(inspectionsBeforeSelection)
      expect(voice.install).not.toHaveBeenCalled()

      await act(async () => {
        persistence.resolve()
      })
      await act(async () => {
        await Promise.resolve()
      })
      expect(voice.resolveTranscription).toHaveBeenCalledTimes(inspectionsBeforeSelection)
      expect(voice.install).not.toHaveBeenCalled()

      await act(async () => {
        inspection.resolve()
      })
      await selecting
      await waitFor(() =>
        expect(voice.install).toHaveBeenCalledWith({
          modelId: APPLE_ASR_MODEL_ID,
          language: 'zh-CN',
          source: 'settings'
        })
      )
      expect(voice.install).toHaveBeenCalledTimes(1)
      await waitFor(() =>
        expect(voice.resolveTranscription.mock.calls.length).toBeGreaterThan(inspectionsBeforeSelection)
      )
    } finally {
      if (originalPreferences) vi.mocked(useMultiplePreferences).mockImplementation(originalPreferences)
    }
  })

  it('downloads an Apple recognition locale only after pending speech resolution and voice listing finish', async () => {
    const user = userEvent.setup()
    const speechGate = deferred<void>()
    const voicesGate = deferred<void>()
    const installation = deferred<void>()
    let releaseInspections = false
    let inspectionsSettled = false
    const readySpeech = {
      modelId: APPLE_TTS_MODEL_ID,
      voice: 'voice.exact',
      language: 'en-US',
      speed: 1,
      status: { status: 'ready' as const }
    }
    voice.resolveSpeech.mockImplementation(() =>
      releaseInspections ? Promise.resolve(readySpeech) : speechGate.promise.then(() => readySpeech)
    )
    voice.listVoices.mockImplementation(() =>
      releaseInspections
        ? Promise.resolve([{ id: 'voice.exact', name: 'Exact Voice', language: 'en-US' }])
        : voicesGate.promise.then(() => [{ id: 'voice.exact', name: 'Exact Voice', language: 'en-US' }])
    )
    voice.install.mockImplementation(() => ({
      result: inspectionsSettled ? installation.promise : Promise.reject(new VoiceDomainError('busy'))
    }))
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.voice.speech.model_id': APPLE_TTS_MODEL_ID,
      'feature.voice.speech.voice_id': 'voice.exact',
      'feature.voice.speech.language': 'en-US',
      'feature.voice.speech.speed': 1
    })

    const { rerender } = render(<VoiceSettings />)
    const language = screen.getByRole('combobox', { name: 'Recognition language' })
    await waitFor(() => expect(language).toBeEnabled())
    await waitFor(() => expect(voice.resolveSpeech).toHaveBeenCalled())
    await waitFor(() => expect(voice.listVoices).toHaveBeenCalled())
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.speech.speed', 1.5)
    rerender(<VoiceSettings />)

    await user.click(language)
    await user.click(screen.getByRole('option', { name: /Chinese.*Download/ }))
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await act(async () => {
        await Promise.resolve()
      })
    }
    expect(voice.install).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.language')).toBe('zh-CN')

    releaseInspections = true
    inspectionsSettled = true
    await act(async () => {
      speechGate.resolve()
      voicesGate.resolve()
    })
    await waitFor(() =>
      expect(voice.install).toHaveBeenCalledWith({
        modelId: APPLE_ASR_MODEL_ID,
        language: 'zh-CN',
        source: 'settings'
      })
    )
    voice.listTranscriptionLocales.mockResolvedValue({ supported: ['en-US', 'zh-CN', 'ja-JP'], installed: ['zh-CN'] })
    await act(async () => {
      installation.resolve()
    })
    const recognitionStatus = within(document.getElementById('setting-voice-recognition-status')!).getByRole('status')
    await waitFor(() => expect(recognitionStatus).toHaveTextContent('Ready'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(within(document.getElementById('setting-voice-speech-status')!).getByRole('status')).toHaveTextContent(
      'Ready'
    )
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.language')).toBe('en-US')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.voice_id')).toBe('voice.exact')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.speed')).toBe(1.5)
    expect(voice.install).toHaveBeenCalledTimes(1)
  })

  it('restores the saved locale status after installation fails', async () => {
    const user = userEvent.setup()
    const refresh = deferred<void>()
    let inspections = 0
    let selected = false
    voice.resolveTranscription.mockImplementation(() => {
      inspections += 1
      if (!selected) {
        return Promise.resolve({ modelId: APPLE_ASR_MODEL_ID, status: { status: 'ready' as const } })
      }
      return refresh.promise.then(() => ({
        modelId: APPLE_ASR_MODEL_ID,
        status: { status: 'not_installed' as const, reason: 'asset_required' as const }
      }))
    })
    voice.install.mockImplementation(() => ({ result: Promise.reject(new VoiceDomainError('download_failed')) }))
    render(<VoiceSettings />)
    const language = screen.getByRole('combobox', { name: 'Recognition language' })
    await waitFor(() => expect(language).toBeEnabled())
    await waitFor(() => expect(inspections).toBeGreaterThan(0))
    const inspectionsBeforeSelection = inspections
    selected = true

    await user.click(language)
    await user.click(screen.getByRole('option', { name: /Chinese.*Download/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/download/i))
    await waitFor(() => expect(inspections).toBeGreaterThan(inspectionsBeforeSelection))
    const recognitionStatus = within(document.getElementById('setting-voice-recognition-status')!).getByRole('status')
    expect(recognitionStatus).toHaveTextContent('Loading')
    await act(async () => {
      refresh.resolve()
    })
    await waitFor(() =>
      expect(recognitionStatus).toHaveTextContent('Speech resources must be installed for this language.')
    )
    expect(language).toBeEnabled()
    expect(language).toHaveTextContent('Chinese')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.language')).toBe('zh-CN')
  })

  it('keeps a failed language selection available for explicit retry without automatic downloads', async () => {
    const user = userEvent.setup()
    voice.install.mockImplementationOnce(() => ({ result: Promise.reject(new VoiceDomainError('download_failed')) }))
    render(<VoiceSettings />)
    const language = screen.getByRole('combobox', { name: 'Recognition language' })
    await waitFor(() => expect(language).toBeEnabled())
    await user.click(language)
    await user.click(screen.getByRole('option', { name: /Chinese.*Download/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/download/i))
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.language')).toBe('zh-CN')
    expect(language).toHaveTextContent('Chinese')
    expect(voice.install).toHaveBeenCalledTimes(1)
    await user.click(language)
    await user.click(screen.getByRole('option', { name: /Chinese.*Download/ }))
    await waitFor(() => expect(voice.install).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    await user.click(language)
    await user.click(screen.getByRole('option', { name: 'English (United States)' }))
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.language')).toBe('en-US')
    expect(voice.install).toHaveBeenCalledTimes(2)
  })

  it('opens system-managed voice resources from the language menu and refreshes on return', async () => {
    const user = userEvent.setup()
    render(<VoiceSettings />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Preview voice' })).toBeEnabled())
    await user.click(screen.getByRole('combobox', { name: 'Speech language' }))
    await user.click(screen.getByRole('option', { name: 'Open system voice settings' }))
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.language')).toBeNull()
    expect(voice.openSystemVoiceSettings).toHaveBeenCalledOnce()
    voice.listVoices.mockResolvedValue([
      { id: 'voice.exact', name: 'Exact Voice', language: 'en-US' },
      { id: 'japanese', name: 'Japanese Voice', language: 'ja-JP' }
    ])
    fireEvent.focus(window)
    await user.click(screen.getByRole('combobox', { name: 'Speech language' }))
    expect(await screen.findByRole('option', { name: 'Japanese (Japan)' })).toBeEnabled()
  })

  it('does not overwrite another language selection when an installation completes after leaving settings', async () => {
    const user = userEvent.setup()
    const installation = deferred<void>()
    voice.install.mockReturnValue({ result: installation.promise })
    const { unmount } = render(<VoiceSettings />)
    const language = screen.getByRole('combobox', { name: 'Recognition language' })
    await waitFor(() => expect(language).toBeEnabled())
    await user.click(language)
    await user.click(screen.getByRole('option', { name: /Chinese.*Download/ }))
    await waitFor(() => expect(voice.install).toHaveBeenCalledTimes(1))
    unmount()
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.language', 'ja-JP')
    await act(async () => installation.resolve())
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.language')).toBe('ja-JP')
    render(<VoiceSettings />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Recognition language' })).toBeEnabled())
    expect(screen.getByRole('combobox', { name: 'Recognition language' })).toHaveTextContent('Japanese')
    expect(voice.install).toHaveBeenCalledTimes(1)
  })

  it('uses system settings for recognition engines without in-app language installation', async () => {
    const user = userEvent.setup()
    voice.listModels.mockResolvedValue({
      models: models.map((model) => (model.id === APPLE_ASR_MODEL_ID ? { ...model, resourceOperations: [] } : model)),
      defaultAsrModelId: APPLE_ASR_MODEL_ID,
      defaultSpeechModelId: APPLE_TTS_MODEL_ID
    })
    render(<VoiceSettings />)
    const language = screen.getByRole('combobox', { name: 'Recognition language' })
    await waitFor(() => expect(language).toBeEnabled())
    await user.click(language)
    expect(screen.getByRole('option', { name: /Chinese/ })).not.toHaveTextContent('Download')
    await user.click(screen.getByRole('option', { name: 'Open system voice settings' }))
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.language')).toBeNull()
    expect(voice.openSystemVoiceSettings).toHaveBeenCalledOnce()
    expect(voice.install).not.toHaveBeenCalled()
  })

  it('links downloadable recognition models to their own resource card', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', FUNASR_MODEL_ID)
    voice.resolveTranscription.mockResolvedValue({
      modelId: FUNASR_MODEL_ID,
      status: { status: 'not_installed', reason: 'model_required' }
    })
    render(<VoiceSettings />)
    expect(await screen.findByText('Download a speech recognition model in Local Models.')).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Preview voice' })).toBeDisabled()
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
    expect(screen.getByRole('button', { name: 'Preview voice' })).toBeDisabled()
  })

  it('returns to the language default voice when the user changes language', async () => {
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
      expect(screen.getByRole('combobox', { name: 'Speech voice' })).toHaveTextContent(
        'Language default · Japanese Voice'
      )
    )
    expect(screen.getByRole('button', { name: 'Preview voice' })).toBeEnabled()
  })

  it('keeps Stop available while playback is active even if configuration becomes unavailable', async () => {
    render(<VoiceSettings />)
    publishSpeech({ phase: 'playing', progress: { completed: 0, total: 1 } })
    const stop = screen.getByRole('button', { name: 'Stop' })
    expect(stop).toBeEnabled()
    await userEvent.setup().click(stop)
    expect(voice.speechStop).toHaveBeenCalledOnce()
  })

  it.each(['stop', 'interruption'] as const)('restarts preview after %s cancels pending playback', async (mode) => {
    const generating = deferred<void>()
    const output = deferred<void>()
    const audioPlay = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
    let onSessionEvent: ((event: VoiceSessionEvent) => void) | undefined
    const ipc = {
      request: vi.fn(),
      on: vi.fn((_channel: string, listener: (event: VoiceSessionEvent) => void) => {
        onSessionEvent = listener
        return () => {
          onSessionEvent = undefined
        }
      })
    }
    let first = true
    let revision = 0
    const playbackState: VoicePlaybackState = {
      attemptId: 1,
      commandRevision: 0,
      synthesis: 'completed',
      desired: 'playing',
      observed: 'ready',
      pendingCommand: 'resume',
      availableCommands: ['pause', 'stop']
    }
    ipc.request.mockImplementation(async (route, input) => {
      if (route === 'ai.voice.session.state') return { phase: 'idle', revision }
      if (route === 'ai.speech.generate') {
        if (first) {
          first = false
          onSessionEvent?.({
            type: 'state',
            phase: 'generating',
            revision: ++revision,
            sessionId: input.sessionId,
            source: 'playback',
            playback: { ...playbackState, synthesis: 'generating', observed: 'empty', pendingCommand: null }
          })
          generating.resolve()
          await output.promise
        }
        return {
          sessionId: input.sessionId,
          requestId: input.requestId,
          output: { id: crypto.randomUUID(), url: 'cherry-media://audio/preview', mimeType: 'audio/wav' },
          playback: playbackState
        }
      }
      if (route === 'ai.voice.playback.report') {
        return {
          phase: input.phase,
          revision: ++revision,
          sessionId: input.sessionId,
          source: 'playback',
          playback: { ...playbackState, observed: input.phase, pendingCommand: null }
        }
      }
      if (route === 'ai.speech.abort' || route === 'ai.voice.session.discard') return
      throw new Error(`Unexpected IPC route: ${route}`)
    })
    const client = new VoiceService({
      ipc,
      ownerWindow: new EventTarget() as Window,
      readSpeechPreferences: async () => ({ modelId: APPLE_TTS_MODEL_ID, voice: 'exact', language: 'en-US', speed: 1 })
    })
    const playback = new SpeechPlaybackService({ voice: client, ownerWindow: new EventTarget() as Window })
    const unsubscribe = playback.subscribe(() => {
      voice.speech = playback.getSnapshot()
      voice.speechListeners.forEach((listener) => listener())
    })
    voice.speechStart.mockImplementation((input) => playback.start(input))
    voice.speechStop.mockImplementation(() => playback.stop())
    try {
      const { user, play } = await renderPreviewTest()
      await user.click(play)
      await generating.promise
      if (mode === 'stop') await user.click(screen.getByRole('button', { name: 'Stop' }))
      await act(async () => {
        if (mode === 'interruption') {
          onSessionEvent?.({ type: 'interruption', revision: ++revision })
          onSessionEvent?.({ type: 'state', phase: 'idle', revision: ++revision })
          output.reject(new VoiceDomainError('aborted'))
        } else output.resolve()
        await voice.speechStart.mock.results[0].value.catch(() => undefined)
      })
      expect(audioPlay).not.toHaveBeenCalled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Preview voice' }))
      await waitFor(() => expect(audioPlay).toHaveBeenCalledOnce())
      expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
    } finally {
      output.resolve()
      await act(async () => playback.teardown())
      unsubscribe()
      await client.teardown()
    }
  })

  it.each(['unmount', 'preference', 'hide'] as const)(
    'cancels a pending preview start after %s even when the sample catalog is already loaded',
    async (action) => {
      const starting = deferred<{ status: 'started' }>()
      voice.speechStart.mockReturnValueOnce(starting.promise)
      const view = render(
        <Activity mode="visible">
          <VoiceSettings />
        </Activity>
      )
      const user = userEvent.setup()
      const play = screen.getByRole('button', { name: 'Preview voice' })
      await waitFor(() => expect(play).toBeEnabled())
      await user.click(play)
      await waitFor(() => expect(voice.speechStart).toHaveBeenCalledOnce())
      expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
      const signal = voice.speechStart.mock.calls[0][0].signal as AbortSignal

      if (action === 'unmount') view.unmount()
      else if (action === 'hide')
        view.rerender(
          <Activity mode="hidden">
            <VoiceSettings />
          </Activity>
        )
      else {
        MockUsePreferenceUtils.setPreferenceValue('feature.voice.speech.speed', 1.2)
        view.rerender(
          <Activity mode="visible">
            <VoiceSettings />
          </Activity>
        )
      }

      expect(signal.aborted).toBe(true)
      await act(async () => starting.reject(new VoiceDomainError('aborted')))
      if (action === 'hide')
        view.rerender(
          <Activity mode="visible">
            <VoiceSettings />
          </Activity>
        )
      if (action !== 'unmount') {
        await waitFor(() => expect(screen.getByRole('button', { name: 'Preview voice' })).toBeEnabled())
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      }
    }
  )

  it('keeps a new preview pending when a cancelled preview reports a late failure', async () => {
    const old = deferred<any>()
    const next = deferred<{ status: 'started' }>()
    voice.speechStart.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    render(<VoiceSettings />)
    const button = screen.getByRole('button', { name: 'Preview voice' })
    await waitFor(() => expect(button).toBeEnabled())
    const user = userEvent.setup()
    await user.click(button)
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await user.click(screen.getByRole('button', { name: 'Preview voice' }))
    await act(async () => old.reject(new VoiceDomainError('operation_failed')))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
    await act(async () => next.resolve({ status: 'started' }))
    expect(screen.getByRole('button', { name: 'Preview voice' })).toBeEnabled()
  })

  it('reports a published preview failure once and clears it when playback recovers elsewhere', async () => {
    const starting = deferred<{ status: 'started' }>()
    voice.speechStart.mockReturnValueOnce(starting.promise)
    const { play, user } = await renderPreviewTest()

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

    const playbackTest = within(screen.getByRole('group', { name: 'Preview voice' }))
    expect(await playbackTest.findByRole('alert')).toHaveTextContent(/operation failed/i)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(play).toHaveAccessibleDescription(/operation failed/i)

    publishSpeech({ phase: 'playing', sourceLabel: 'preview', progress: { completed: 0, total: 1 } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(play).not.toHaveAccessibleDescription()
  })

  it('keeps an unpublished preview failure beside its controls until the next preview action', async () => {
    const starting = deferred<{ status: 'started' }>()
    voice.speechStart.mockReturnValueOnce(starting.promise)
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    const { play, user } = await renderPreviewTest()

    await user.click(play)
    publishSpeech({ phase: 'playing', sourceLabel: 'message', progress: { completed: 0, total: 1 } })
    await act(async () => starting.reject(new Error('Preview preparation failed')))

    const playbackTest = within(screen.getByRole('group', { name: 'Preview voice' }))
    expect(await playbackTest.findByRole('alert')).toHaveTextContent(/operation failed/i)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(play).toHaveAccessibleDescription(/operation failed/i)

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

    await user.click(screen.getByRole('button', { name: /^stop$/i }))

    const playbackTest = within(screen.getByRole('group', { name: 'Preview voice' }))
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

    await waitFor(() => expect(screen.getByRole('button', { name: /preview voice/i })).toBeDisabled())
    expect(voice.speechStart).not.toHaveBeenCalled()
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
})
