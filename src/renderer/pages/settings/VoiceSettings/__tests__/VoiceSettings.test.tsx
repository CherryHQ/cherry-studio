import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { type SpeechPlaybackSnapshot, VoiceDomainError } from '@renderer/services/voice'
import { VoiceTargetManager } from '@renderer/services/voice/VoiceTargetManager'
import { APPLE_ASR_MODEL_ID, APPLE_TTS_MODEL_ID, FUNASR_MODEL_ID } from '@shared/ai/localVoice'

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
    targetManager: undefined as VoiceTargetManager | undefined
  }
})

vi.mock('@renderer/services/voice', async () => ({
  VoiceDomainError: (await import('@renderer/services/voice/VoiceService')).VoiceDomainError,
  getDefaultVoiceLanguage: (await import('@renderer/services/voice/voiceLanguage')).getDefaultVoiceLanguage,
  voiceService: {
    initialize: vi.fn(async () => undefined),
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

import VoiceSettings from '../VoiceSettings'

const models = [
  { id: APPLE_ASR_MODEL_ID, name: 'Apple System ASR' },
  { id: APPLE_TTS_MODEL_ID, name: 'Apple System TTS' },
  { id: FUNASR_MODEL_ID, name: 'FunASR Nano' }
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
    voice.microphone.mockReset()
    voice.openMicrophoneSettings.mockReset()
    voice.listModels.mockResolvedValue({ models })
    voice.listTranscriptionLocales.mockResolvedValue({ supported: ['en-US', 'zh-CN', 'ja-JP'], installed: ['en-US'] })
    voice.listVoices.mockResolvedValue([{ id: 'voice.exact', name: 'Exact Voice', language: 'en-US' }])
    voice.getModelStatus.mockResolvedValue({ status: 'ready' })
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
    voice.dictation = { phase: 'idle', elapsedMs: 0, recoveryAvailable: false }
    voice.speech = { phase: 'idle', progress: { completed: 0, total: 0 } }
    confirm.mockReset()
    vi.clearAllMocks()
  })

  it('follows the interface for unset languages without saving the derived default', async () => {
    voice.listModels.mockResolvedValue({ models, defaultAsrModelId: APPLE_ASR_MODEL_ID })
    voice.listVoices.mockResolvedValue([
      { id: 'voice.english', name: 'Samantha', language: 'en-US' },
      { id: 'voice.chinese', name: 'Tingting', language: 'zh-CN' },
      { id: 'voice.japanese', name: 'Kyoko', language: 'ja-JP' }
    ])
    await i18n.changeLanguage('zh-CN')
    const user = userEvent.setup()
    const { unmount } = render(<VoiceSettings />)

    await waitFor(() => expect(screen.getByRole('combobox', { name: '识别语言' })).toHaveTextContent('跟随界面'))
    expect(screen.getByRole('combobox', { name: '朗读语言' })).toHaveTextContent('中文（中国）')
    await user.click(screen.getByRole('combobox', { name: '朗读语音' }))
    expect(await screen.findByRole('option', { name: 'Tingting' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Samantha' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    await act(async () => i18n.changeLanguage('ja-JP'))
    expect(screen.getByRole('combobox', { name: '認識言語' })).toHaveTextContent('日本語')
    expect(screen.getByRole('combobox', { name: '読み上げ言語' })).toHaveTextContent('日本語')
    await user.click(screen.getByRole('combobox', { name: '読み上げ音声' }))
    expect(await screen.findByRole('option', { name: 'Kyoko' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Samantha' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await act(async () => i18n.changeLanguage('en-US'))
    expect(screen.getByRole('combobox', { name: 'Speech language' })).toHaveTextContent('English (United States)')
    await user.click(screen.getByRole('combobox', { name: 'Speech voice' }))
    expect(await screen.findByRole('option', { name: 'Samantha' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Tingting' })).not.toBeInTheDocument()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.language')).toBeNull()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.language')).toBeNull()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.voice_id')).toBeNull()
    unmount()
  })

  it('restores interface defaults after an explicit language choice', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.voice.recognition.model_id': APPLE_ASR_MODEL_ID,
      'feature.voice.recognition.language': 'ja-JP',
      'feature.voice.speech.language': 'zh-CN',
      'feature.voice.speech.voice_id': 'voice.chinese'
    })
    voice.listVoices.mockResolvedValue([
      { id: 'voice.english', name: 'Samantha', language: 'en-US' },
      { id: 'voice.chinese', name: 'Tingting', language: 'zh-CN' }
    ])
    const user = userEvent.setup()
    const { rerender } = render(<VoiceSettings />)
    const recognition = screen.getByRole('combobox', { name: 'Recognition language' })
    await waitFor(() => expect(recognition).toBeEnabled())
    expect(recognition).toHaveTextContent('Japanese (Japan)')
    await user.click(recognition)
    await user.click(await screen.findByRole('option', { name: 'Follow interface (English (United States))' }))
    rerender(<VoiceSettings />)
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.language')).toBe('')
    expect(recognition).toHaveTextContent('Follow interface')

    await user.click(screen.getByRole('combobox', { name: 'Speech language' }))
    await user.click(await screen.findByRole('option', { name: 'Follow interface (English (United States))' }))
    rerender(<VoiceSettings />)
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.language')).toBe('')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.voice_id')).toBe('')
    expect(screen.getByRole('combobox', { name: 'Speech language' })).toHaveTextContent('Follow interface')
    await user.click(screen.getByRole('combobox', { name: 'Speech voice' }))
    expect(await screen.findByRole('option', { name: 'Samantha' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Tingting' })).not.toBeInTheDocument()
  })

  it('keeps missing configuration discoverable', async () => {
    render(<VoiceSettings />)

    expect(await screen.findByRole('heading', { name: /voice/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/recognition model/i)).toHaveTextContent(/not configured/i)
    expect(screen.getByLabelText(/speech language/i)).toHaveTextContent('Follow interface (English (United States))')
    expect(screen.getByRole('combobox', { name: /speech voice/i })).toHaveTextContent(/not configured/i)
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

  it('offers supported Apple recognition languages and saves the chosen locale', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    const { unmount } = render(<VoiceSettings />)

    const language = await screen.findByRole('combobox', { name: /recognition language/i })
    const user = userEvent.setup()
    await waitFor(() => expect(language).toBeEnabled())
    await user.click(language)
    const chinese = await screen.findByRole('option', { name: 'Chinese (China)' })
    expect(screen.queryByRole('option', { name: /French/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /recognition language/i })).not.toBeInTheDocument()

    await user.click(chinese)
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.language')).toBe('zh-CN')
    )
    unmount()
    render(<VoiceSettings />)
    await waitFor(() =>
      expect(voice.getModelStatus).toHaveBeenCalledWith({ modelId: APPLE_ASR_MODEL_ID, language: 'zh-CN' })
    )
  })

  it('does not reuse the previous language readiness while a newly selected language is checked', async () => {
    const japaneseStatus = deferred<{ status: 'not_installed'; reason: 'asset_required' }>()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.voice.recognition.model_id': APPLE_ASR_MODEL_ID,
      'feature.voice.recognition.language': 'en-US'
    })
    voice.getModelStatus.mockImplementation(({ language }) =>
      language === 'ja-JP' ? japaneseStatus.promise : Promise.resolve({ status: 'ready' })
    )
    const { rerender } = render(<VoiceSettings />)

    const record = await screen.findByRole('button', { name: /record test/i })
    await waitFor(() => expect(record).toBeEnabled())
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.language', 'ja-JP')
    rerender(<VoiceSettings />)

    expect(record).toBeDisabled()
    await act(async () => japaneseStatus.resolve({ status: 'not_installed', reason: 'asset_required' }))
    expect(await screen.findByRole('button', { name: /install/i })).toBeEnabled()
  })

  it('can install Apple assets for the existing English default without writing a locale preference', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    voice.getModelStatus.mockResolvedValue({ status: 'not_installed', reason: 'asset_required' })
    render(<VoiceSettings />)

    const language = await screen.findByRole('combobox', { name: /recognition language/i })
    await waitFor(() => expect(language).toHaveTextContent('English (United States)'))
    fireEvent.click(await screen.findByRole('button', { name: /install/i }))
    await waitFor(() => expect(voice.install).toHaveBeenCalledWith({ language: 'en-US', source: 'settings' }))
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.language')).toBeNull()
  })

  it('uses the Main recommended ASR model without persisting it or installing assets', async () => {
    voice.listModels.mockResolvedValue({ models, defaultAsrModelId: APPLE_ASR_MODEL_ID })
    render(<VoiceSettings />)

    const record = await screen.findByRole('button', { name: /record test/i })
    await waitFor(() => expect(record).toBeEnabled())
    fireEvent.click(record)

    expect(voice.dictationStartScoped).toHaveBeenCalledWith()
    expect(screen.getByLabelText(/recognition model/i)).toHaveTextContent(/not configured/i)
    expect(MockUsePreferenceUtils.getAllPreferenceValues()).not.toHaveProperty('feature.voice.recognition.model_id')
    expect(voice.install).not.toHaveBeenCalled()
  })

  it('filters voices by the default or chosen language and can restore the interface default', async () => {
    voice.listVoices.mockResolvedValue([
      { id: 'voice.english', name: 'Samantha', language: 'en-US' },
      { id: 'voice.chinese', name: 'Tingting', language: 'zh-CN' },
      { id: 'voice.chinese.premium', name: 'Tingting (Premium)', language: 'zh-CN' }
    ])
    const user = userEvent.setup()
    const { rerender } = render(<VoiceSettings />)
    const language = screen.getByRole('combobox', { name: /speech language/i })
    expect(screen.getByRole('combobox', { name: /speech voice/i })).toHaveTextContent(/not configured/i)
    expect(screen.getByText('Speech voice')).toBeInTheDocument()
    await user.click(language)
    const chinese = await screen.findByRole('option', { name: 'Chinese (China)' })
    expect(screen.getAllByRole('option', { name: 'Chinese (China)' })).toHaveLength(1)

    await user.click(chinese)
    rerender(<VoiceSettings />)
    const voiceInput = screen.getByRole('combobox', { name: /speech voice/i })
    expect(voiceInput).toBeEnabled()
    await user.click(voiceInput)
    expect(await screen.findByRole('option', { name: 'Tingting' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Tingting (Premium)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Samantha|zh-CN/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: 'Tingting (Premium)' }))
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.voice_id')).toBe('voice.chinese.premium')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.language')).toBe('zh-CN')
    rerender(<VoiceSettings />)

    await user.click(language)
    await user.click(await screen.findByRole('option', { name: 'Follow interface (English (United States))' }))
    rerender(<VoiceSettings />)
    expect(screen.getByRole('combobox', { name: /speech voice/i })).toHaveTextContent(/not configured/i)
    expect(screen.getByText('Speech voice')).toBeInTheDocument()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.voice_id')).toBe('')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.language')).toBe('')
  })

  it('uses matching language-region labels and groups regional variants in both language selectors', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    voice.listTranscriptionLocales.mockResolvedValue({
      supported: ['en-US', 'fr-FR', 'en-GB', 'en-AU'],
      installed: ['en-US']
    })
    voice.listVoices.mockResolvedValue([
      { id: 'voice.us', name: 'Samantha', language: 'en-US' },
      { id: 'voice.fr', name: 'Thomas', language: 'fr-FR' },
      { id: 'voice.gb', name: 'Daniel', language: 'en-GB' },
      { id: 'voice.au', name: 'Karen', language: 'en-AU' }
    ])
    render(<VoiceSettings />)
    const user = userEvent.setup()
    const recognitionLanguage = screen.getByRole('combobox', { name: /recognition language/i })
    await waitFor(() => expect(recognitionLanguage).toBeEnabled())
    await user.click(recognitionLanguage)
    const labels = ['English (Australia)', 'English (United Kingdom)', 'English (United States)', 'French (France)']
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'Follow interface (English (United States))',
      ...labels
    ])

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('combobox', { name: /speech language/i }))
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'Follow interface (English (United States))',
      ...labels
    ])
  })

  it.each([
    {
      locale: 'en-US',
      label: 'Arabic (world)',
      recognition: 'Recognition language',
      speech: 'Speech language',
      voice: 'Speech voice'
    },
    { locale: 'zh-CN', label: '阿拉伯语（世界）', recognition: '识别语言', speech: '朗读语言', voice: '朗读语音' }
  ])('localizes the world region in $locale when Electron returns its numeric code', async (labels) => {
    await i18n.changeLanguage(labels.locale)
    const nativeOf = Intl.DisplayNames.prototype.of
    const displayName = vi
      .spyOn(Intl.DisplayNames.prototype, 'of')
      .mockImplementation(function (this: Intl.DisplayNames, code) {
        if (code === 'ar-001')
          return this.resolvedOptions().locale.startsWith('zh') ? '阿拉伯语（001）' : 'Arabic (001)'
        return nativeOf.call(this, code)
      })
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    voice.listTranscriptionLocales.mockResolvedValue({ supported: ['ar-001'], installed: ['ar-001'] })
    voice.listVoices.mockResolvedValue([{ id: 'voice.arabic', name: 'Majed', language: 'ar-001' }])
    const view = render(<VoiceSettings />)
    try {
      const user = userEvent.setup()
      const recognition = screen.getByRole('combobox', { name: labels.recognition })
      await waitFor(() => expect(recognition).toBeEnabled())
      await user.click(recognition)
      await user.click(await screen.findByRole('option', { name: labels.label }))
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.language')).toBe('ar-001')

      await user.click(screen.getByRole('combobox', { name: labels.speech }))
      await user.click(await screen.findByRole('option', { name: labels.label }))
      view.rerender(<VoiceSettings />)
      await user.click(screen.getByRole('combobox', { name: labels.voice }))
      await user.click(await screen.findByRole('option', { name: 'Majed' }))
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.language')).toBe('ar-001')
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.voice_id')).toBe('voice.arabic')
    } finally {
      view.unmount()
      displayName.mockRestore()
      await i18n.changeLanguage('en-US')
    }
  })

  it('clears an incompatible voice when the user changes language without selecting a replacement', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.voice.speech.language': 'en-US',
      'feature.voice.speech.voice_id': 'voice.exact'
    })
    voice.listVoices.mockResolvedValue([
      { id: 'voice.exact', name: 'Exact Voice', language: 'en-US' },
      { id: 'voice.chinese', name: 'Tingting', language: 'zh-CN' }
    ])
    const { rerender } = render(<VoiceSettings />)
    const language = screen.getByRole('combobox', { name: /speech language/i })
    const user = userEvent.setup()
    await user.click(language)
    await user.click(await screen.findByRole('option', { name: 'Chinese (China)' }))
    rerender(<VoiceSettings />)

    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.language')).toBe('zh-CN')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.voice_id')).toBe('')
    expect(screen.getByRole('combobox', { name: /speech voice/i })).toHaveTextContent(/not configured/i)
    expect(screen.getByRole('button', { name: /play preview/i })).toBeDisabled()
  })

  it('derives the language from an existing voice without rewriting saved settings', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.speech.voice_id', 'voice.exact')
    voice.listVoices.mockResolvedValue([{ id: 'voice.exact', name: 'Exact Voice', language: 'zh-CN' }])
    render(<VoiceSettings />)

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /speech language/i })).toHaveTextContent('Chinese (China)')
    )
    expect(screen.getByRole('combobox', { name: /speech voice/i })).toHaveTextContent('Exact Voice')
    await act(async () => i18n.changeLanguage('ja-JP'))
    expect(screen.getByRole('combobox', { name: i18n.t('settings.voice.speech.language') })).toHaveTextContent('中国語')
    expect(screen.getByRole('combobox', { name: i18n.t('settings.voice.speech.voice') })).toHaveTextContent(
      'Exact Voice'
    )
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.language')).toBeNull()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.voice_id')).toBe('voice.exact')
  })

  it('keeps an unavailable saved voice visible without silently substituting another voice', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.voice.speech.language': 'en-US',
      'feature.voice.speech.voice_id': 'voice.removed'
    })
    render(<VoiceSettings />)

    const voiceInput = screen.getByRole('combobox', { name: /speech voice/i })
    expect(voiceInput).toHaveTextContent(/voice.*unavailable/i)
    await userEvent.setup().click(voiceInput)
    expect(await screen.findByRole('option', { name: /voice.*unavailable/i })).toHaveAttribute('aria-disabled', 'true')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.voice_id')).toBe('voice.removed')
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

  it('waits for the current speech voice check before allowing preview', async () => {
    const nextVoiceStatus = deferred<{ status: 'ready' }>()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.voice.speech.model_id': APPLE_TTS_MODEL_ID,
      'feature.voice.speech.voice_id': 'voice.exact',
      'feature.voice.speech.language': 'en-US'
    })
    voice.getModelStatus.mockImplementation(({ voice: voiceId }) =>
      voiceId === 'voice.next' ? nextVoiceStatus.promise : Promise.resolve({ status: 'ready' })
    )
    const { rerender } = render(<VoiceSettings />)
    await userEvent.setup().type(screen.getByRole('textbox', { name: /preview text/i }), 'Hello world')
    const preview = screen.getByRole('button', { name: /play preview/i })
    await waitFor(() => expect(preview).toBeEnabled())

    MockUsePreferenceUtils.setPreferenceValue('feature.voice.speech.voice_id', 'voice.next')
    rerender(<VoiceSettings />)
    expect(preview).toBeDisabled()
    await act(async () => nextVoiceStatus.resolve({ status: 'ready' }))
    expect(preview).toBeEnabled()
  })

  it.each([
    ['voice.exact', false],
    ['voice.third', false],
    ['voice.third', true]
  ])('waits for an older voice check when switching to %s (previous check fails: %s)', async (finalVoice, fails) => {
    const pendingStatus = deferred<{ status: 'ready' }>()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.voice.speech.model_id': APPLE_TTS_MODEL_ID,
      'feature.voice.speech.voice_id': 'voice.exact'
    })
    voice.getModelStatus.mockImplementation(({ voice: voiceId }) =>
      voiceId === 'voice.pending' ? pendingStatus.promise : Promise.resolve({ status: 'ready' })
    )
    const { rerender } = render(<VoiceSettings />)
    await userEvent.setup().type(screen.getByRole('textbox', { name: /preview text/i }), 'Hello world')
    const preview = screen.getByRole('button', { name: /play preview/i })
    await waitFor(() => expect(preview).toBeEnabled())
    await act(async () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.voice.speech.voice_id', 'voice.pending')
      rerender(<VoiceSettings />)
    })
    expect(preview).toBeDisabled()

    await act(async () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.voice.speech.voice_id', finalVoice)
      rerender(<VoiceSettings />)
    })
    expect(preview).toBeDisabled()
    await act(async () => {
      if (fails) pendingStatus.reject(new Error('Voice check failed'))
      else pendingStatus.resolve({ status: 'ready' })
    })
    expect(preview).toBeEnabled()
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

  it('replaces the full test text instead of inserting at a moved cursor', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    render(<VoiceSettings />)

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

    const recordingTest = within(document.getElementById('setting-voice-recognition-test')!)
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

    const recordingTest = within(document.getElementById('setting-voice-recognition-test')!)
    const playbackTest = within(document.getElementById('setting-voice-speech-test')!)
    expect(await recordingTest.findByRole('alert')).toHaveTextContent(/no speech was detected/i)
    expect(await playbackTest.findByRole('alert')).toHaveTextContent(/operation failed/i)
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

    const playbackTest = within(document.getElementById('setting-voice-speech-test')!)
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

    const playbackTest = within(document.getElementById('setting-voice-speech-test')!)
    expect(await playbackTest.findByRole('alert')).toHaveTextContent(/operation failed/i)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(input).toHaveAccessibleDescription(/operation failed/i)

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

    await user.click(screen.getByRole('button', { name: /^stop$/i }))

    const playbackTest = within(document.getElementById('setting-voice-speech-test')!)
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

  it('does not let an older preview rejection restore an error after a newer preview starts', async () => {
    const first = deferred<{ status: 'started' }>()
    const second = deferred<{ status: 'started' }>()
    voice.speechStart.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { play, user } = await renderPreviewTest()

    await user.click(play)
    await user.click(play)
    publishSpeech({ phase: 'generating', sourceLabel: 'preview', progress: { completed: 0, total: 1 } })
    await act(async () => first.reject(new VoiceDomainError('operation_failed')))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => second.resolve({ status: 'started' }))
  })

  it('clears the previous result when starting a new recording test', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    render(<VoiceSettings />)

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

  it('preserves an interrupted recording until the user chooses to transcribe or discard it', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    voice.dictation = { phase: 'recorded', elapsedMs: 12_000, recoveryAvailable: false }
    render(<VoiceSettings />)

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

  it('waits for microphone status before allowing an explicit test when OS preflight is unknown', async () => {
    const user = userEvent.setup()
    const microphone = deferred<'unknown'>()
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    voice.microphone.mockReturnValue(microphone.promise)
    render(<VoiceSettings />)

    const record = await screen.findByRole('button', { name: /record test/i })
    expect(record).toBeDisabled()
    await user.click(record)
    expect(voice.dictationStartScoped).not.toHaveBeenCalled()

    await act(async () => microphone.resolve('unknown'))
    await waitFor(() => expect(record).toBeEnabled())
    await user.click(record)
    expect(voice.dictationStartScoped).toHaveBeenCalledOnce()
  })

  it.each(['denied', 'restricted'] as const)(
    'refreshes an initially %s microphone permission after returning from OS settings',
    async (status) => {
      const user = userEvent.setup()
      MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
      voice.microphone.mockResolvedValue(status)
      render(<VoiceSettings />)

      const settings = await screen.findByRole('button', { name: /open microphone settings/i })
      const record = screen.getByRole('button', { name: /record test/i })
      expect(record).toBeDisabled()
      await user.click(settings)
      expect(voice.openMicrophoneSettings).toHaveBeenCalledOnce()

      voice.microphone.mockResolvedValue('granted')
      fireEvent.focus(window)
      await waitFor(() => expect(record).toBeEnabled())
      await user.click(record)
      expect(voice.dictationStartScoped).toHaveBeenCalledOnce()
    }
  )

  it('keeps an unsupported interface recognition locale visible without substituting English', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    voice.listTranscriptionLocales.mockResolvedValue({ supported: ['en-US'], installed: ['en-US'] })
    voice.getModelStatus.mockImplementation(async ({ language }) => ({
      status: language === 'en-US' ? 'ready' : 'unsupported',
      ...(language !== 'en-US' && { reason: 'unsupported' })
    }))
    await i18n.changeLanguage('ja-JP')
    render(<VoiceSettings />)

    expect(await screen.findByRole('combobox', { name: '認識言語' })).toHaveTextContent('日本語')
    expect(await screen.findByText('このシステムではサポートされていません')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '録音テスト' })).toBeDisabled()
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
