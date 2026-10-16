import { sliceByTokens } from 'tokenx'

import { WebSearchError } from '../errors'
export function sliceContent(
  content: string,
  limits: Readonly<{ maxTokens?: number; maxCharacters?: number }>
): Readonly<{ content: string; truncated: boolean }> {
  for (const limit of [limits.maxTokens, limits.maxCharacters]) {
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 0))
      throw new WebSearchError('Invalid content limit', { kind: 'configuration', code: 'invalid_content_limit' })
  }
  let sliced = limits.maxCharacters === undefined ? content : content.slice(0, limits.maxCharacters)
  if (limits.maxTokens !== undefined) sliced = limits.maxTokens === 0 ? '' : sliceByTokens(sliced, 0, limits.maxTokens)
  if (sliced.length < content.length && /[\uD800-\uDBFF]$/.test(sliced)) sliced = sliced.slice(0, -1)
  return { content: sliced, truncated: sliced !== content }
}
