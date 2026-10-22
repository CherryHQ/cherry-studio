const MEDIA_ANALYSIS_REQUEST_ERROR_MESSAGE =
  "Cherry Studio couldn't turn this audio or video attachment into text. Choose a speech recognition model in Voice settings and a Video Vision Model in Model settings, or remove the attachment and try again."

/**
 * Unusable or failed audio/video preprocessing. Chat and Agent stop the turn
 * and show `error.media_unreadable_without_preprocessing`. Empty speech is not
 * this error: a completed analysis with `no_speech` stays an inline note.
 */
export class NonNativeMediaAnalysisError extends Error {
  readonly i18nKey = 'media_unreadable_without_preprocessing'
  /** Keep this off the provider-auth classifier. The message names the settings to open. */
  readonly providerErrorCategory = 'content' as const

  constructor() {
    super(MEDIA_ANALYSIS_REQUEST_ERROR_MESSAGE)
    this.name = 'NonNativeMediaAnalysisError'
  }
}
