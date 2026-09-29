import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { LOCAL_VOICE_MODELS, WINDOWS_TTS_MODEL_ID } from '@shared/ai/localVoice'

vi.unmock('@cherrystudio/ui')

const voice = vi.hoisted(() => ({
  listModels: vi.fn(),
  listVoices: vi.fn(),
  listTranscriptionLocales: vi.fn(),
  getModelStatus: vi.fn(),
  speechStart: vi.fn(),
  dictation: { phase: 'idle', elapsedMs: 0, recoveryAvailable: false },
  speech: { phase: 'idle', progress: { completed: 0, total: 0 } }
}))

vi.mock('@renderer/services/voice', () => ({
  voiceService: {
    initialize: async () => undefined,
    listModels: voice.listModels,
    listVoices: voice.listVoices,
    listTranscriptionLocales: voice.listTranscriptionLocales,
    getModelStatus: voice.getModelStatus,
    getMicrophoneStatus: async () => 'denied'
  },
  dictationService: {
    subscribe: () => () => undefined,
    getSnapshot: () => voice.dictation
  },
  speechPlaybackService: {
    subscribe: () => () => undefined,
    getSnapshot: () => voice.speech,
    start: voice.speechStart
  },
  voiceTargetManager: { bind: () => () => undefined }
}))

vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))

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
    voice.listModels.mockResolvedValue({ models: LOCAL_VOICE_MODELS.filter(({ id }) => id === WINDOWS_TTS_MODEL_ID) })
    voice.listVoices.mockResolvedValue([{ id: 'windows.huihui', name: 'Microsoft Huihui', language: 'zh-CN' }])
    voice.listTranscriptionLocales.mockRejectedValue(new Error('unsupported'))
    voice.getModelStatus.mockResolvedValue({ status: 'ready' })
    voice.speechStart.mockResolvedValue({ status: 'started' })
    vi.clearAllMocks()
  })

  it('configures and previews a Windows voice without ASR or microphone access', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<VoiceSettings />)

    await user.click(await screen.findByRole('combobox', { name: /speech model/i }))
    await user.click(await screen.findByRole('option', { name: 'Windows System Speech' }))
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.model_id')).toBe(WINDOWS_TTS_MODEL_ID)
    )
    rerender(<VoiceSettings />)
    await user.click(screen.getByRole('combobox', { name: /speech voice/i }))
    await user.click(await screen.findByRole('option', { name: 'Microsoft Huihui (zh-CN)' }))
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.voice_id')).toBe('windows.huihui')
    )
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.speech.language', 'zh-CN')
    rerender(<VoiceSettings />)

    await waitFor(() =>
      expect(voice.getModelStatus).toHaveBeenCalledWith({
        modelId: WINDOWS_TTS_MODEL_ID,
        voice: 'windows.huihui',
        language: 'zh-CN'
      })
    )
    await user.type(screen.getByRole('textbox', { name: /preview text/i }), 'Read this with the selected voice')
    expect(screen.getByRole('button', { name: /record test/i })).toBeDisabled()
    const preview = screen.getByRole('button', { name: /play preview/i })
    await waitFor(() => expect(preview).toBeEnabled())
    await user.click(preview)

    expect(voice.speechStart).toHaveBeenCalledWith({
      text: 'Read this with the selected voice',
      trigger: 'manual',
      sourceLabel: 'preview',
      sourceEntityId: 'voice-settings'
    })
  })

  it('requires an explicit Windows voice before preview', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.voice.speech.model_id': WINDOWS_TTS_MODEL_ID,
      'feature.voice.speech.voice_id': ''
    })
    render(<VoiceSettings />)

    await user.type(await screen.findByRole('textbox', { name: /preview text/i }), 'Select a voice first')
    expect(screen.getByRole('button', { name: /play preview/i })).toBeDisabled()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.voice_id')).toBe('')
    expect(voice.speechStart).not.toHaveBeenCalled()
  })

  it('keeps an unknown configured speech model unsupported without substituting Windows speech', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.voice.speech.model_id': 'unknown-tts',
      'feature.voice.speech.voice_id': 'windows.huihui'
    })
    render(<VoiceSettings />)

    await user.type(await screen.findByRole('textbox', { name: /preview text/i }), 'Keep my model selection')
    expect(await screen.findByText('Not supported on this system')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /play preview/i })).toBeDisabled()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.speech.model_id')).toBe('unknown-tts')
    expect(voice.getModelStatus).not.toHaveBeenCalled()
    expect(voice.speechStart).not.toHaveBeenCalled()
  })
})
