import type { CherryMessagePart, FileUIPart } from '@shared/data/types/message'
import { type ComposerMessageToken, readCherryMeta, withCherryMeta } from '@shared/data/types/uiParts'

/** Assemble after file materialization so completion order cannot change the submitted draft. */
export function createOrderedComposerParts(parts: CherryMessagePart[], files: FileUIPart[]): CherryMessagePart[] {
  const textPart = parts.find((part) => part.type === 'text')
  const tokens = textPart ? (readCherryMeta(textPart)?.composer?.tokens ?? []) : []
  const fileTokens = tokens.filter((token) => token.kind === 'file')
  if (!files.length && !fileTokens.length) return parts
  if (!textPart) throw new Error('Missing composer draft for attachments')

  const byId = new Map<string, FileUIPart>()
  for (const file of files) {
    const sourceId = readCherryMeta(file)?.fileTokenSourceId
    if (!sourceId || byId.has(`file:${sourceId}`)) throw new Error('Ambiguous composer attachment identity')
    byId.set(`file:${sourceId}`, file)
  }
  const result: CherryMessagePart[] = []
  const sorted = tokens.toSorted((a, b) => a.textOffset - b.textOffset || a.index - b.index)
  let cursor = 0
  let segmentTokens: ComposerMessageToken[] = []
  const pushText = (end: number) => {
    const text = textPart.text.slice(cursor, end)
    if (text || segmentTokens.length) {
      result.push(
        withCherryMeta(
          { ...textPart, text },
          {
            ...readCherryMeta(textPart),
            contentFormat: 'ordered-parts-v1',
            composer: { version: 1, tokens: segmentTokens }
          }
        )
      )
    }
    segmentTokens = []
    cursor = end
  }

  for (const token of sorted) {
    if (!Number.isInteger(token.textOffset) || token.textOffset < cursor || token.textOffset > textPart.text.length) {
      throw new Error('Invalid composer attachment position')
    }
    if (token.kind !== 'file') {
      segmentTokens.push({ ...token, textOffset: token.textOffset - cursor })
      continue
    }
    const file = byId.get(token.id)
    if (!file) throw new Error('Missing composer attachment')
    pushText(token.textOffset)
    result.push(withCherryMeta(file, { ...readCherryMeta(file), contentFormat: 'ordered-parts-v1' }))
    byId.delete(token.id)
  }
  pushText(textPart.text.length)
  if (byId.size) throw new Error('Composer attachment has no position')
  return [...result, ...parts.filter((part) => part !== textPart)]
}
