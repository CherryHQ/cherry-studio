import { normalizeIllustrationCount, type IllustrationPolicy } from '@shared/data/types/illustration'

export function getIllustrationSystemPrompt(policy?: IllustrationPolicy): string | undefined {
  if (!policy || policy.mode === 'off') return undefined
  const count = normalizeIllustrationCount(policy.count)
  const quantity = `${count} illustration${count === 1 ? '' : 's'}`
  const instruction =
    policy.mode === 'on'
      ? `You must include exactly ${quantity} in each reply.`
      : `You may include illustrations when they help explain your answer; omit them when unnecessary. Include no more than ${quantity} in one reply.`
  return `${instruction}
Place each illustration at its intended position in your answer using this exact format, outside code blocks and on separate lines:
[[IMAGE]]
A self-contained, detailed image-generation prompt describing the subject, composition, style and any required labels.
[[/IMAGE]]
Write the actual image prompt as part of this same reply. Do not describe the protocol or show it as an example. Continue your answer normally after the closing marker. The application generates the image asynchronously and replaces this block. Do not call an image-generation tool for these illustrations.`
}
