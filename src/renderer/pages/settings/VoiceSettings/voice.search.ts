import type { SettingsSearchEntry } from '../settingsSearch/types'

export const route = '/settings/voice'

export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'microphone',
    titleKey: 'settings.voice.microphone.label',
    groupKey: 'settings.voice.recognition.title',
    aliases: ['microphone', '麦克风']
  },
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
    anchorId: 'dictation-mouse-hold',
    titleKey: 'settings.voice.mouse_hold.label',
    descriptionKey: 'settings.voice.mouse_hold.description',
    groupKey: 'settings.voice.recognition.title',
    aliases: ['mouse hold', 'long press', '长按鼠标', '鼠标听写']
  },
  {
    anchorId: 'dictation-hold',
    titleKey: 'settings.voice.shortcuts.hold.label',
    groupKey: 'settings.voice.recognition.title',
    aliases: ['hold to dictate', '按住听写', 'Alt']
  },
  {
    anchorId: 'dictation-toggle',
    titleKey: 'settings.voice.shortcuts.toggle.label',
    groupKey: 'settings.voice.recognition.title',
    aliases: ['toggle dictation', '切换听写', 'Ctrl Alt']
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
