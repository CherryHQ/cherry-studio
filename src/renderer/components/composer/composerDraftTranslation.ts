import type { ComposerSerializedDraft, ComposerSerializedToken } from './tokens'

type ComposerDraftTranslator = (text: string) => Promise<string | undefined>

interface MaskedToken {
  marker: string
  token: ComposerSerializedToken
}

const TOKEN_MARKER_PREFIX = '[[CHERRY_COMPOSER_TOKEN'

function createMarkerPrefix(text: string) {
  let namespace = 0
  let prefix = `${TOKEN_MARKER_PREFIX}_${namespace}_`

  while (text.includes(prefix)) {
    namespace += 1
    prefix = `${TOKEN_MARKER_PREFIX}_${namespace}_`
  }

  return prefix
}

function maskComposerTokens(draft: ComposerSerializedDraft) {
  const markerPrefix = createMarkerPrefix(draft.text)
  const orderedTokens = draft.tokens.toSorted(
    (first, second) => first.textOffset - second.textOffset || first.index - second.index
  )
  const maskedTokens: MaskedToken[] = []
  let maskedText = ''
  let translatableText = ''
  let cursor = 0

  orderedTokens.forEach((token, index) => {
    const offset = Math.min(draft.text.length, Math.max(0, token.textOffset))
    if (offset < cursor) {
      throw new Error('Composer draft tokens overlap and cannot be translated safely')
    }

    const textBeforeToken = draft.text.slice(cursor, offset)
    maskedText += textBeforeToken
    translatableText += textBeforeToken

    const marker = `${markerPrefix}${index}]]`
    maskedText += marker
    maskedTokens.push({ marker, token })

    if (token.promptText) {
      if (!draft.text.startsWith(token.promptText, offset)) {
        throw new Error('Composer draft token prompt text is out of sync')
      }
      cursor = offset + token.promptText.length
    } else {
      cursor = offset
    }
  })

  const textAfterTokens = draft.text.slice(cursor)
  maskedText += textAfterTokens
  translatableText += textAfterTokens

  return { maskedText, maskedTokens, translatableText }
}

function restoreComposerTokens(translatedText: string, maskedTokens: readonly MaskedToken[]): ComposerSerializedDraft {
  let text = ''
  let cursor = 0
  const tokens: ComposerSerializedToken[] = []

  maskedTokens.forEach(({ marker, token }, index) => {
    const markerOffset = translatedText.indexOf(marker, cursor)
    const markerIsUnique = markerOffset >= 0 && translatedText.indexOf(marker, markerOffset + marker.length) < 0
    if (!markerIsUnique) {
      throw new Error('Translation did not preserve composer token markers')
    }

    text += translatedText.slice(cursor, markerOffset)
    tokens.push({ ...token, index, textOffset: text.length })
    text += token.promptText ?? ''
    cursor = markerOffset + marker.length
  })

  text += translatedText.slice(cursor)
  return { text, tokens }
}

/**
 * Translates the user-authored parts of a composer draft while keeping rich
 * tokens outside the model's translation surface. Marker loss fails closed so
 * callers never replace a valid draft with one that silently drops tokens.
 */
export async function translateComposerDraft(
  draft: ComposerSerializedDraft,
  translate: ComposerDraftTranslator
): Promise<ComposerSerializedDraft | null> {
  if (!draft.tokens.length) {
    if (!draft.text.trim()) return null
    const translatedText = await translate(draft.text)
    return translatedText ? { text: translatedText, tokens: [] } : null
  }

  const { maskedText, maskedTokens, translatableText } = maskComposerTokens(draft)
  if (!translatableText.trim()) return null

  const translatedText = await translate(maskedText)
  return translatedText ? restoreComposerTokens(translatedText, maskedTokens) : null
}
