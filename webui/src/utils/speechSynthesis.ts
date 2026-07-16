export type SpeechSynthesisControllerState = {
  readonly messageId?: string
  readonly isSpeaking: boolean
}

export type SpeechVoiceOption = {
  readonly voiceURI: string
  readonly name: string
  readonly lang: string
  readonly localService: boolean
  readonly default: boolean
}

export type SpeechPreferences = {
  readonly rate: number
  readonly pitch: number
  readonly volume: number
  readonly voiceURI: string
}

export const SPEECH_PREFERENCES_STORAGE_KEY = 'cherry-webui.speech-preferences'
export const DEFAULT_SPEECH_PREFERENCES: SpeechPreferences = {
  rate: 1,
  pitch: 1,
  volume: 1,
  voiceURI: ''
}

export const SPEECH_RATE_MIN = 0.5
export const SPEECH_RATE_MAX = 2
export const SPEECH_PITCH_MIN = 0
export const SPEECH_PITCH_MAX = 2
export const SPEECH_VOLUME_MIN = 0
export const SPEECH_VOLUME_MAX = 1

/** Keep segments short to reduce Android speechSynthesis mid-utterance drops. */
const SPEECH_SEGMENT_MAX_CHARS = 220

type SpeechSynthesisControllerOptions = {
  readonly onStateChange: (state: SpeechSynthesisControllerState) => void
  readonly getPreferences?: () => SpeechPreferences
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export const clampSpeechPreferences = (input: Partial<SpeechPreferences> | null | undefined): SpeechPreferences => ({
  rate: clamp(isFiniteNumber(input?.rate) ? input.rate : DEFAULT_SPEECH_PREFERENCES.rate, SPEECH_RATE_MIN, SPEECH_RATE_MAX),
  pitch: clamp(
    isFiniteNumber(input?.pitch) ? input.pitch : DEFAULT_SPEECH_PREFERENCES.pitch,
    SPEECH_PITCH_MIN,
    SPEECH_PITCH_MAX
  ),
  volume: clamp(
    isFiniteNumber(input?.volume) ? input.volume : DEFAULT_SPEECH_PREFERENCES.volume,
    SPEECH_VOLUME_MIN,
    SPEECH_VOLUME_MAX
  ),
  voiceURI: typeof input?.voiceURI === 'string' ? input.voiceURI : DEFAULT_SPEECH_PREFERENCES.voiceURI
})

export const loadSpeechPreferences = (): SpeechPreferences => {
  if (typeof window === 'undefined') return DEFAULT_SPEECH_PREFERENCES
  try {
    const raw = window.localStorage.getItem(SPEECH_PREFERENCES_STORAGE_KEY)
    if (!raw) return DEFAULT_SPEECH_PREFERENCES
    return clampSpeechPreferences(JSON.parse(raw) as Partial<SpeechPreferences>)
  } catch {
    return DEFAULT_SPEECH_PREFERENCES
  }
}

export const saveSpeechPreferences = (preferences: SpeechPreferences) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SPEECH_PREFERENCES_STORAGE_KEY, JSON.stringify(clampSpeechPreferences(preferences)))
  } catch {
    // Ignore quota / private-mode failures; preferences stay in-memory for the session.
  }
}

export const detectSpeechSynthesisSupport = (): boolean => {
  if (typeof window === 'undefined') return false
  const synth = window.speechSynthesis
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return false
  if (typeof synth.speak !== 'function' || typeof synth.cancel !== 'function') return false
  // Some non-Chromium Android shells expose the object but cannot actually speak.
  try {
    if (typeof synth.getVoices === 'function') {
      // Access is enough; empty voice list is still allowed (voices may load later).
      void synth.getVoices()
    }
  } catch {
    return false
  }
  return true
}

export const listSpeechVoices = (): SpeechVoiceOption[] => {
  if (typeof window === 'undefined' || !window.speechSynthesis?.getVoices) return []
  try {
    return window.speechSynthesis
      .getVoices()
      .map((voice) => ({
        voiceURI: voice.voiceURI,
        name: voice.name,
        lang: voice.lang,
        localService: voice.localService,
        default: voice.default
      }))
      .sort((left, right) => {
        if (left.lang === right.lang) return left.name.localeCompare(right.name)
        return left.lang.localeCompare(right.lang)
      })
  } catch {
    return []
  }
}

export const splitSpeechText = (text: string, maxChars = SPEECH_SEGMENT_MAX_CHARS): string[] => {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  if (normalized.length <= maxChars) return [normalized]

  const segments: string[] = []
  let remaining = normalized
  while (remaining.length > maxChars) {
    const windowText = remaining.slice(0, maxChars + 1)
    const breakMatch = windowText.match(/^([\s\S]*?[.!?。！？；;\n])\s+[\s\S]*$/)
    let cut = breakMatch?.[1]?.length ?? -1
    if (cut < Math.floor(maxChars * 0.4)) {
      const spaceCut = windowText.lastIndexOf(' ', maxChars)
      cut = spaceCut > Math.floor(maxChars * 0.4) ? spaceCut : maxChars
    }
    const part = remaining.slice(0, cut).trim()
    if (part) segments.push(part)
    remaining = remaining.slice(cut).trim()
  }
  if (remaining) segments.push(remaining)
  return segments
}

const pickVoice = (voices: readonly SpeechSynthesisVoice[], voiceURI: string, language: string) => {
  if (voiceURI) {
    const exact = voices.find((voice) => voice.voiceURI === voiceURI)
    if (exact) return exact
  }
  const lower = language.toLowerCase()
  const languageBase = lower.split('-')[0] ?? lower
  return (
    voices.find((voice) => voice.lang.toLowerCase() === lower) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(`${languageBase}-`)) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(languageBase)) ??
    voices.find((voice) => voice.default) ??
    voices[0]
  )
}

export const createSpeechSynthesisController = ({ onStateChange, getPreferences }: SpeechSynthesisControllerOptions) => {
  const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis
  let isSupported = detectSpeechSynthesisSupport()
  let currentMessageId: string | undefined
  let queue: SpeechSynthesisUtterance[] = []
  let activeUtterance: SpeechSynthesisUtterance | undefined
  let generation = 0

  const notify = () =>
    onStateChange({
      messageId: currentMessageId,
      isSpeaking: Boolean(activeUtterance) || queue.length > 0
    })

  const refreshSupport = () => {
    isSupported = detectSpeechSynthesisSupport()
    return isSupported
  }

  const clearQueue = () => {
    queue = []
    activeUtterance = undefined
  }

  const stop = () => {
    generation += 1
    clearQueue()
    currentMessageId = undefined
    if (synth) {
      try {
        synth.cancel()
      } catch {
        // Some mobile engines throw on cancel when idle.
      }
    }
    notify()
  }

  const speakNext = (token: number) => {
    if (!synth || token !== generation) return
    const next = queue.shift()
    if (!next) {
      activeUtterance = undefined
      currentMessageId = undefined
      notify()
      return
    }

    activeUtterance = next
    notify()
    try {
      // Chrome/Android can get stuck after cancel; resume before speaking.
      if (synth.paused) synth.resume()
      synth.speak(next)
    } catch {
      clearQueue()
      currentMessageId = undefined
      notify()
    }
  }

  const buildUtterance = (text: string, language: string, preferences: SpeechPreferences) => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = language
    utterance.rate = preferences.rate
    utterance.pitch = preferences.pitch
    utterance.volume = preferences.volume
    if (synth) {
      try {
        const voice = pickVoice(synth.getVoices(), preferences.voiceURI, language)
        if (voice) {
          utterance.voice = voice
          utterance.lang = voice.lang || language
        }
      } catch {
        // Keep utterance without an explicit voice.
      }
    }
    return utterance
  }

  const speakSegments = (messageId: string, text: string, language: string) => {
    if (!synth || !refreshSupport()) return false

    const speechText = text.trim()
    if (!speechText) return false

    if (currentMessageId === messageId && (activeUtterance || queue.length > 0)) {
      stop()
      return true
    }

    const preferences = clampSpeechPreferences(getPreferences?.() ?? DEFAULT_SPEECH_PREFERENCES)
    const segments = splitSpeechText(speechText)
    if (!segments.length) return false

    stop()
    const token = generation
    currentMessageId = messageId
    queue = segments.map((segment) => {
      const utterance = buildUtterance(segment, language, preferences)
      utterance.onend = () => {
        if (token !== generation || activeUtterance !== utterance) return
        activeUtterance = undefined
        speakNext(token)
      }
      utterance.onerror = () => {
        if (token !== generation) return
        // Drop remaining queue on hard error to avoid endless retries.
        clearQueue()
        currentMessageId = undefined
        notify()
      }
      return utterance
    })
    speakNext(token)
    return true
  }

  const speak = (messageId: string, text: string, language: string) => speakSegments(messageId, text, language)

  const preview = (text: string, language: string) => speakSegments('__speech_preview__', text, language)

  const applyLivePreferences = (preferences: SpeechPreferences) => {
    const next = clampSpeechPreferences(preferences)
    if (activeUtterance) {
      activeUtterance.rate = next.rate
      activeUtterance.pitch = next.pitch
      activeUtterance.volume = next.volume
    }
    for (const utterance of queue) {
      utterance.rate = next.rate
      utterance.pitch = next.pitch
      utterance.volume = next.volume
    }
  }

  return {
    get isSupported() {
      return isSupported
    },
    refreshSupport,
    speak,
    preview,
    stop,
    applyLivePreferences
  }
}
