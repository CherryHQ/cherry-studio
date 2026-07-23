export type SpeechSynthesisControllerState = {
  readonly messageId?: string
  readonly isSpeaking: boolean
  readonly isPaused: boolean
  readonly segmentIndex: number
  readonly segmentCount: number
  readonly paragraphIndex: number
  readonly paragraphCount: number
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

export type SpeechPanelPreferences = {
  /** When true, message read-aloud opens the right Speech tab. */
  readonly autoOpenPanel: boolean
}

export const SPEECH_PREFERENCES_STORAGE_KEY = 'cherry-webui.speech-preferences'
export const SPEECH_PANEL_PREFERENCES_STORAGE_KEY = 'cherry-webui.speech-panel-preferences'
export const DEFAULT_SPEECH_PREFERENCES: SpeechPreferences = {
  rate: 1,
  pitch: 1,
  volume: 1,
  voiceURI: ''
}
export const DEFAULT_SPEECH_PANEL_PREFERENCES: SpeechPanelPreferences = {
  autoOpenPanel: true
}

export const SPEECH_RATE_MIN = 0.5
export const SPEECH_RATE_MAX = 3
export const SPEECH_PITCH_MIN = 0
export const SPEECH_PITCH_MAX = 2
export const SPEECH_VOLUME_MIN = 0
export const SPEECH_VOLUME_MAX = 1

/** Keep segments short to reduce Android speechSynthesis mid-utterance drops. */
const SPEECH_SEGMENT_MAX_CHARS = 220

type SpeechSegment = {
  readonly text: string
  readonly paragraphIndex: number
}

type SpeechSynthesisControllerOptions = {
  readonly onStateChange: (state: SpeechSynthesisControllerState) => void
  readonly getPreferences?: () => SpeechPreferences
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export const clampSpeechPreferences = (input: Partial<SpeechPreferences> | null | undefined): SpeechPreferences => ({
  rate: clamp(
    isFiniteNumber(input?.rate) ? input.rate : DEFAULT_SPEECH_PREFERENCES.rate,
    SPEECH_RATE_MIN,
    SPEECH_RATE_MAX
  ),
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

export const clampSpeechPanelPreferences = (
  input: Partial<SpeechPanelPreferences> | null | undefined
): SpeechPanelPreferences => ({
  autoOpenPanel:
    typeof input?.autoOpenPanel === 'boolean' ? input.autoOpenPanel : DEFAULT_SPEECH_PANEL_PREFERENCES.autoOpenPanel
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

export const loadSpeechPanelPreferences = (): SpeechPanelPreferences => {
  if (typeof window === 'undefined') return DEFAULT_SPEECH_PANEL_PREFERENCES
  try {
    const raw = window.localStorage.getItem(SPEECH_PANEL_PREFERENCES_STORAGE_KEY)
    if (!raw) return DEFAULT_SPEECH_PANEL_PREFERENCES
    return clampSpeechPanelPreferences(JSON.parse(raw) as Partial<SpeechPanelPreferences>)
  } catch {
    return DEFAULT_SPEECH_PANEL_PREFERENCES
  }
}

export const saveSpeechPanelPreferences = (preferences: SpeechPanelPreferences) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      SPEECH_PANEL_PREFERENCES_STORAGE_KEY,
      JSON.stringify(clampSpeechPanelPreferences(preferences))
    )
  } catch {
    // Ignore quota / private-mode failures.
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

/** Split long text into speakable chunks, preferring sentence boundaries. */
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

/** Sentence split used for prev/next sentence navigation (keeps short chunks for TTS). */
export const splitSpeechSentences = (text: string, maxChars = SPEECH_SEGMENT_MAX_CHARS): string[] => {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const rough = normalized
    .split(/(?<=[.!?。！？；;])\s+|(?<=[.!?。！？；;])(?=[^\s])|\n+/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (!rough.length) return splitSpeechText(normalized, maxChars)

  const segments: string[] = []
  for (const part of rough) {
    if (part.length <= maxChars) {
      segments.push(part)
      continue
    }
    segments.push(...splitSpeechText(part, maxChars))
  }
  return segments
}

/** Paragraph → sentence segments for navigation. */
export const buildSpeechSegments = (text: string, maxChars = SPEECH_SEGMENT_MAX_CHARS): SpeechSegment[] => {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const paragraphs = normalized
    .split(/\n{2,}|\n/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (!paragraphs.length) return []

  const segments: SpeechSegment[] = []
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const sentences = splitSpeechSentences(paragraph, maxChars)
    for (const sentence of sentences) {
      segments.push({ text: sentence, paragraphIndex })
    }
  })
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

const emptyState = (): SpeechSynthesisControllerState => ({
  isSpeaking: false,
  isPaused: false,
  segmentIndex: 0,
  segmentCount: 0,
  paragraphIndex: 0,
  paragraphCount: 0
})

export const createSpeechSynthesisController = ({
  onStateChange,
  getPreferences
}: SpeechSynthesisControllerOptions) => {
  const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis
  let isSupported = detectSpeechSynthesisSupport()
  let currentMessageId: string | undefined
  let language = 'en-US'
  let segments: SpeechSegment[] = []
  let segmentIndex = 0
  let isPaused = false
  let activeUtterance: SpeechSynthesisUtterance | undefined
  let generation = 0

  const paragraphCount = () => {
    if (!segments.length) return 0
    return Math.max(...segments.map((segment) => segment.paragraphIndex)) + 1
  }

  const notify = () => {
    // Session is active while speaking or paused mid-message.
    const messageActive = Boolean(currentMessageId) && segments.length > 0 && (Boolean(activeUtterance) || isPaused)
    onStateChange({
      messageId: currentMessageId,
      isSpeaking: messageActive,
      isPaused,
      segmentIndex: segments.length ? Math.min(segmentIndex, segments.length - 1) : 0,
      segmentCount: segments.length,
      paragraphIndex: segments[segmentIndex]?.paragraphIndex ?? 0,
      paragraphCount: paragraphCount()
    })
  }

  const refreshSupport = () => {
    isSupported = detectSpeechSynthesisSupport()
    return isSupported
  }

  const hardCancelSynth = () => {
    if (!synth) return
    try {
      synth.cancel()
    } catch {
      // Some mobile engines throw on cancel when idle.
    }
  }

  const stop = () => {
    generation += 1
    activeUtterance = undefined
    isPaused = false
    currentMessageId = undefined
    segments = []
    segmentIndex = 0
    language = 'en-US'
    hardCancelSynth()
    notify()
  }

  const buildUtterance = (text: string, token: number) => {
    const preferences = clampSpeechPreferences(getPreferences?.() ?? DEFAULT_SPEECH_PREFERENCES)
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
    utterance.onend = () => {
      if (token !== generation || activeUtterance !== utterance) return
      activeUtterance = undefined
      isPaused = false
      const nextIndex = segmentIndex + 1
      if (nextIndex >= segments.length) {
        // Finished all segments.
        currentMessageId = undefined
        segments = []
        segmentIndex = 0
        notify()
        return
      }
      segmentIndex = nextIndex
      speakCurrent(token)
    }
    utterance.onerror = () => {
      if (token !== generation) return
      activeUtterance = undefined
      isPaused = false
      currentMessageId = undefined
      segments = []
      segmentIndex = 0
      notify()
    }
    return utterance
  }

  const speakCurrent = (token: number) => {
    if (!synth || token !== generation) return
    const segment = segments[segmentIndex]
    if (!segment) {
      activeUtterance = undefined
      isPaused = false
      currentMessageId = undefined
      segments = []
      segmentIndex = 0
      notify()
      return
    }

    isPaused = false
    const utterance = buildUtterance(segment.text, token)
    activeUtterance = utterance
    notify()
    try {
      if (synth.paused) synth.resume()
      synth.speak(utterance)
    } catch {
      activeUtterance = undefined
      isPaused = false
      currentMessageId = undefined
      segments = []
      segmentIndex = 0
      notify()
    }
  }

  const beginSession = (messageId: string, text: string, nextLanguage: string, startIndex = 0) => {
    if (!synth || !refreshSupport()) return false
    const speechText = text.trim()
    if (!speechText) return false

    const nextSegments = buildSpeechSegments(speechText)
    if (!nextSegments.length) return false

    generation += 1
    const token = generation
    hardCancelSynth()
    activeUtterance = undefined
    isPaused = false
    currentMessageId = messageId
    language = nextLanguage
    segments = nextSegments
    segmentIndex = Math.max(0, Math.min(startIndex, nextSegments.length - 1))
    speakCurrent(token)
    return true
  }

  const speak = (messageId: string, text: string, nextLanguage: string) => {
    // Toggle stop when the same message is already speaking/paused.
    if (currentMessageId === messageId && (activeUtterance || isPaused)) {
      stop()
      return true
    }
    return beginSession(messageId, text, nextLanguage, 0)
  }

  const preview = (text: string, nextLanguage: string) => beginSession('__speech_preview__', text, nextLanguage, 0)

  const pause = () => {
    if (!synth || !activeUtterance || isPaused) return false
    try {
      synth.pause()
      isPaused = true
      notify()
      return true
    } catch {
      return false
    }
  }

  const resume = () => {
    if (!synth || !currentMessageId || !segments.length) return false
    if (isPaused && activeUtterance) {
      try {
        synth.resume()
        isPaused = false
        notify()
        return true
      } catch {
        // Fall through to re-speak current segment.
      }
    }
    if (!activeUtterance) {
      generation += 1
      speakCurrent(generation)
      return true
    }
    return false
  }

  const play = () => {
    if (isPaused) return resume()
    if (activeUtterance) return true
    if (currentMessageId && segments.length) {
      generation += 1
      speakCurrent(generation)
      return true
    }
    return false
  }

  const jumpToSegment = (index: number) => {
    if (!currentMessageId || !segments.length) return false
    if (index < 0 || index >= segments.length) return false
    generation += 1
    const token = generation
    hardCancelSynth()
    activeUtterance = undefined
    isPaused = false
    segmentIndex = index
    speakCurrent(token)
    return true
  }

  const previousSentence = () => {
    if (!segments.length) return false
    const target = Math.max(0, segmentIndex - 1)
    return jumpToSegment(target)
  }

  const nextSentence = () => {
    if (!segments.length) return false
    const target = Math.min(segments.length - 1, segmentIndex + 1)
    if (target === segmentIndex && segmentIndex >= segments.length - 1) return false
    return jumpToSegment(target)
  }

  const previousParagraph = () => {
    if (!segments.length) return false
    const currentParagraph = segments[segmentIndex]?.paragraphIndex ?? 0
    if (currentParagraph <= 0) return jumpToSegment(0)
    const targetParagraph = currentParagraph - 1
    const targetIndex = segments.findIndex((segment) => segment.paragraphIndex === targetParagraph)
    if (targetIndex < 0) return false
    return jumpToSegment(targetIndex)
  }

  const nextParagraph = () => {
    if (!segments.length) return false
    const currentParagraph = segments[segmentIndex]?.paragraphIndex ?? 0
    const targetIndex = segments.findIndex((segment) => segment.paragraphIndex > currentParagraph)
    if (targetIndex < 0) return false
    return jumpToSegment(targetIndex)
  }

  const applyLivePreferences = (preferences: SpeechPreferences) => {
    const next = clampSpeechPreferences(preferences)
    if (activeUtterance) {
      activeUtterance.rate = next.rate
      activeUtterance.pitch = next.pitch
      activeUtterance.volume = next.volume
    }
  }

  const getState = (): SpeechSynthesisControllerState => ({
    messageId: currentMessageId,
    isSpeaking: Boolean(currentMessageId) && segments.length > 0 && (Boolean(activeUtterance) || isPaused),
    isPaused,
    segmentIndex: segments.length ? Math.min(segmentIndex, segments.length - 1) : 0,
    segmentCount: segments.length,
    paragraphIndex: segments[segmentIndex]?.paragraphIndex ?? 0,
    paragraphCount: paragraphCount()
  })

  return {
    get isSupported() {
      return isSupported
    },
    refreshSupport,
    speak,
    preview,
    play,
    pause,
    resume,
    stop,
    previousSentence,
    nextSentence,
    previousParagraph,
    nextParagraph,
    applyLivePreferences,
    getState
  }
}
