import { normalizeIllustrationCount, type IllustrationMode } from '@shared/data/types/illustration'

export function getIllustrationSystemPrompt(
  mode?: IllustrationMode,
  options: { maxCount?: number; forceCount?: boolean; targetCount?: number } = {}
): string | undefined {
  if (!mode || mode === 'off') return undefined
  const maxCount = normalizeIllustrationCount(options.maxCount)
  const targetCount = normalizeIllustrationCount(options.targetCount, maxCount)
  const quantity = `${maxCount} illustration${maxCount === 1 ? '' : 's'}`
  const instruction = options.forceCount
    ? `You must include exactly ${targetCount} illustration${targetCount === 1 ? '' : 's'} in each reply.`
    : mode === 'on'
      ? `You must include at least one illustration in each reply, with no more than ${quantity} in total.`
      : `You may include illustrations when they help explain your answer; omit them when unnecessary. Include no more than ${quantity} in one reply.`
  return `${instruction}
Place each illustration at its intended position in your answer using this exact format, outside code blocks and on separate lines:
[[IMAGE]]
A self-contained, detailed image-generation prompt describing the subject, composition, style and any required labels.
[[/IMAGE]]
Write the actual image prompt as part of this same reply. Do not describe the protocol or show it as an example. Continue your answer normally after the closing marker. The application generates the image asynchronously and replaces this block. Do not call an image-generation tool for these illustrations.`
}
