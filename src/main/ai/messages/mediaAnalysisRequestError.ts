const MEDIA_ANALYSIS_REQUEST_ERROR_MESSAGES = {
  media_unreadable_without_preprocessing:
    "Cherry Studio couldn't turn this audio or video attachment into text. Choose a speech recognition model in Voice settings and a Vision Model in Default Model settings, or remove the attachment and try again.",
  media_unreadable_need_vision_model:
    "Cherry Studio couldn't turn this video into text: it has no audio, and no model is available to describe its frames. Choose a Vision Model in Default Model settings, switch to a chat model that supports images, or remove the attachment and try again.",
  media_unreadable_need_speech_model:
    "Cherry Studio couldn't turn this audio or video attachment into text because its speech could not be transcribed. Choose a speech recognition model in Voice settings, or remove the attachment and try again."
} as const

/** What an unusable analysis lacked: a model for the frames, or a transcription of the audio. */
export interface MediaAnalysisGaps {
  vision: boolean
  speech: boolean
}

function gapI18nKey(gaps: MediaAnalysisGaps | undefined): keyof typeof MEDIA_ANALYSIS_REQUEST_ERROR_MESSAGES {
  if (gaps?.vision && !gaps.speech) return 'media_unreadable_need_vision_model'
  if (gaps?.speech && !gaps.vision) return 'media_unreadable_need_speech_model'
  return 'media_unreadable_without_preprocessing'
}

/**
 * Unusable or failed audio/video preprocessing. Chat stops the turn and shows
 * `error.<i18nKey>`, naming only the missing piece when `gaps` identifies one.
 * Empty speech is not this error: a completed analysis with `no_speech` stays an inline note.
 */
export class NonNativeMediaAnalysisError extends Error {
  readonly i18nKey: keyof typeof MEDIA_ANALYSIS_REQUEST_ERROR_MESSAGES
  readonly providerErrorCategory = 'media' as const

  constructor(gaps?: MediaAnalysisGaps) {
    const i18nKey = gapI18nKey(gaps)
    super(MEDIA_ANALYSIS_REQUEST_ERROR_MESSAGES[i18nKey])
    this.i18nKey = i18nKey
    this.name = 'NonNativeMediaAnalysisError'
  }
}
