import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { LOCAL_VOICE_MODELS, WINDOWS_ASR_MODEL_ID, WINDOWS_TTS_MODEL_ID } from '@shared/ai/localVoice'

vi.unmock('@cherrystudio/ui')

const descriptors = LOCAL_VOICE_MODELS.map((model) => ({
  ...model,
  localeSelection: model.id === WINDOWS_ASR_MODEL_ID ? { defaultLocale: 'en-US' } : null,
  resourceOperations: []
}))

const voice = vi.hoisted(() => ({
  resolveTranscription: vi.fn(),
  resolveSpeech: vi.fn(),
  listModels: vi.fn(),
  listVoices: vi.fn(),
  listTranscriptionLocales: vi.fn(),
  getModelStatus: vi.fn(),
  getMicrophoneStatus: vi.fn(),
  speechStart: vi.fn(),
  speech: { phase: 'idle', progress: { completed: 0, total: 0 } }
}))

vi.mock('@renderer/services/voice', async () => ({
  getDefaultVoiceLanguage: (await import('@renderer/services/voice/voiceLanguage')).getDefaultVoiceLanguage,
  enumerateMicrophones: async () => [],
  subscribeMicrophoneChanges: () => () => undefined,
  voiceService: {
    initialize: async () => undefined,
    resolveTranscriptionConfiguration: voice.resolveTranscription,
    resolveSpeechConfiguration: voice.resolveSpeech,
    listModels: voice.listModels,
    listVoices: voice.listVoices,
    listTranscriptionLocales: voice.listTranscriptionLocales,
    getModelStatus: voice.getModelStatus,
    getMicrophoneStatus: voice.getMicrophoneStatus
  },
  speechPlaybackService: {
    subscribe: () => () => undefined,
    getSnapshot: () => voice.speech,
    start: voice.speechStart
  }
}))

vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
import VoiceSettings from '../VoiceSettings'

describe('Windows system speech settings', () => {
  beforeAll(async () => {
    HTMLElement.prototype.hasPointerCapture ??= () => false
    HTMLElement.prototype.setPointerCapture ??= () => undefined
    HTMLElement.prototype.releasePointerCapture ??= () => undefined
    HTMLElement.prototype.scrollIntoView ??= () => undefined
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    voice.listModels.mockResolvedValue({
      models: descriptors.filter(({ id }) => id === WINDOWS_TTS_MODEL_ID),
      defaultSpeechModelId: WINDOWS_TTS_MODEL_ID
    })
    voice.resolveTranscription.mockResolvedValue({ status: { status: 'unsupported' } })
    voice.resolveSpeech.mockResolvedValue({
      modelId: WINDOWS_TTS_MODEL_ID,
      voice: 'windows.huihui',
      language: 'zh-CN',
      status: { status: 'ready' }
    })
    voice.listVoices.mockResolvedValue([{ id: 'windows.huihui', name: 'Microsoft Huihui', language: 'zh-CN' }])
    voice.listTranscriptionLocales.mockRejectedValue(new Error('unsupported'))
    voice.getModelStatus.mockResolvedValue({ status: 'ready' })
    voice.getMicrophoneStatus.mockResolvedValue('denied')
    voice.speechStart.mockResolvedValue({ status: 'started' })
    vi.clearAllMocks()
  })

  it('offers one-click system voice preview without microphone permission or ASR', async () => {
    render(<VoiceSettings />)
    const preview = screen.getByRole('button', { name: 'Preview voice' })
    await waitFor(() => expect(preview).toBeEnabled())
    expect(screen.queryByRole('combobox', { name: 'Speech model' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Speech voice' })).toHaveTextContent(
      'Language default · Microsoft Huihui'
    )
    await userEvent.setup().click(preview)
    expect(voice.speechStart).toHaveBeenCalledWith(
      expect.objectContaining({ sourceLabel: 'preview', trigger: 'manual' })
    )
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.model_id')).toBeNull()
  })

  it('preserves an unavailable Windows engine without offering a download on the voice page', async () => {
    voice.listModels.mockResolvedValue({ models: descriptors })
    voice.listTranscriptionLocales.mockResolvedValue({ supported: [], installed: [] })
    voice.resolveTranscription.mockResolvedValue({
      modelId: WINDOWS_ASR_MODEL_ID,
      status: { status: 'unsupported', reason: 'unsupported' }
    })
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.recognition.model_id', WINDOWS_ASR_MODEL_ID)
    render(<VoiceSettings />)
    expect((await screen.findAllByText('Not supported on this system')).length).toBeGreaterThan(0)
    expect(screen.getByRole('combobox', { name: 'Recognition model' })).toHaveTextContent(
      'Windows System Speech Recognition'
    )
    expect(screen.queryByRole('button', { name: /install/i })).not.toBeInTheDocument()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.model_id')).toBe(WINDOWS_ASR_MODEL_ID)
  })
})
