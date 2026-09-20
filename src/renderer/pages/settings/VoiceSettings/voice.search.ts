import type { SettingsSearchEntry } from '../settingsSearch/types'

export const route = '/settings/voice'

export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'recognition-model',
    titleKey: 'settings.voice.recognition.model',
    groupKey: 'settings.voice.recognition.title',
    aliases: ['ASR', 'speech to text', '语音识别', '语音转文字']
  },
  {
    anchorId: 'recognition-language',
    titleKey: 'settings.voice.recognition.language',
    groupKey: 'settings.voice.recognition.title'
  },
  {
    anchorId: 'recognition-status',
    titleKey: 'settings.voice.status.label',
    groupKey: 'settings.voice.recognition.title'
  },
  {
    anchorId: 'recognition-test',
    titleKey: 'settings.voice.action.record_test',
    groupKey: 'settings.voice.recognition.title'
  },
  {
    anchorId: 'speech-model',
    titleKey: 'settings.voice.speech.model',
    groupKey: 'settings.voice.speech.title',
    aliases: ['TTS', 'text to speech', '语音合成', '文字转语音']
  },
  {
    anchorId: 'speech-voice',
    titleKey: 'settings.voice.speech.voice',
    groupKey: 'settings.voice.speech.title'
  },
  {
    anchorId: 'speech-language',
    titleKey: 'settings.voice.speech.language',
    groupKey: 'settings.voice.speech.title'
  },
  {
    anchorId: 'speech-speed',
    titleKey: 'settings.voice.speech.speed',
    groupKey: 'settings.voice.speech.title'
  },
  {
    anchorId: 'speech-status',
    titleKey: 'settings.voice.status.label',
    groupKey: 'settings.voice.speech.title'
  },
  {
    anchorId: 'speech-test',
    titleKey: 'settings.voice.action.play_preview',
    groupKey: 'settings.voice.speech.title'
  },
  {
    anchorId: 'auto-read',
    titleKey: 'settings.voice.auto_read.label',
    descriptionKey: 'settings.voice.auto_read.description'
  }
]
