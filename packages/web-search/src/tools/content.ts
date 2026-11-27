import { sliceByTokens } from 'tokenx'

export function sliceContent(
  content: string,
  limits: { maxTokens: number; maxCharacters?: number }
): {
  content: string
  truncated: boolean
} {
  if (
    !Number.isInteger(limits.maxTokens) ||
    limits.maxTokens < 0 ||
    (limits.maxCharacters !== undefined && (!Number.isInteger(limits.maxCharacters) || limits.maxCharacters < 0))
  ) {
    throw new TypeError('Content limits must be non-negative integers')
  }
  const bounded = limits.maxCharacters === undefined ? content : content.slice(0, limits.maxCharacters)
  const sliced =
    limits.maxTokens === 0 ? '' : sliceByTokens(bounded, 0, limits.maxTokens).replace(/[\uD800-\uDBFF]$/, '')
  return { content: sliced, truncated: sliced.length < content.length }
}
