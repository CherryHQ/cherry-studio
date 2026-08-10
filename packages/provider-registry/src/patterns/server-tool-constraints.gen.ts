/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Compiled from `Creator.serverToolFunctionMixing` and `Creator.webSearchUnsupportedEfforts`
 * declarations by scripts/generate-catalog.ts — edit the creator and run `pnpm generate`.
 */

/** Models whose provider-native tools coexist with function declarations in one request. */
export const SERVER_TOOL_FUNCTION_MIXING_MODEL_IDS: readonly string[] = [
  'gemini-3-1-flash-image',
  'gemini-3-1-flash-image-preview',
  'gemini-3-1-flash-lite',
  'gemini-3-1-flash-lite-batch',
  'gemini-3-1-flash-lite-image',
  'gemini-3-1-flash-lite-preview',
  'gemini-3-1-flash-live-preview',
  'gemini-3-1-flash-tts-preview',
  'gemini-3-1-pro-preview',
  'gemini-3-1-pro-preview-batch',
  'gemini-3-1-pro-preview-customtools',
  'gemini-3-5-flash',
  'gemini-3-5-flash-batch',
  'gemini-3-5-flash-lite',
  'gemini-3-5-flash-lite-batch',
  'gemini-3-5-live-translate-preview',
  'gemini-3-6-flash',
  'gemini-3-6-flash-batch',
  'gemini-3-flash',
  'gemini-3-flash-preview',
  'gemini-3-flash-preview-batch',
  'gemini-3-pro-image',
  'gemini-3-pro-image-preview',
  'gemini-3-pro-preview',
  'gemini-flash-latest',
  'gemini-pro-latest'
]

/** Reasoning efforts the provider-native web-search tool rejects, by model id. */
export const WEB_SEARCH_UNSUPPORTED_EFFORTS: Readonly<Record<string, readonly string[]>> = {
  'gpt-5': ['minimal'],
  'gpt-5-batch': ['minimal'],
  'gpt-5-codex': ['minimal'],
  'gpt-5-codex-batch': ['minimal'],
  'gpt-5-image': ['minimal'],
  'gpt-5-image-mini': ['minimal'],
  'gpt-5-mini': ['minimal'],
  'gpt-5-mini-batch': ['minimal'],
  'gpt-5-nano': ['minimal'],
  'gpt-5-nano-batch': ['minimal'],
  'gpt-5-pro': ['minimal'],
  'gpt-5-pro-batch': ['minimal']
}
