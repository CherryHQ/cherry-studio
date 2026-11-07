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
references: ["image_1"]
A self-contained, detailed image-generation prompt describing the subject, composition, style and any required labels.
[[/IMAGE]]
The optional first line, references, is a JSON array of user-image references supplied by the application immediately before the corresponding images. Select zero, one, or several images independently for each illustration. Use references when editing an original, preserving a person or object's appearance, or using its style or layout. Select only the images needed and list them in the order described by the prompt. Never invent references or use images absent from this request. Omit the references line or use references: [] for an unrelated illustration or text-only image generation. Do not include reference-selection instructions in the image prompt itself.
Write the actual image prompt as part of this same reply. Do not describe the protocol or show it as an example. Continue your answer normally after the closing marker. The application generates the image asynchronously and replaces this block. Do not call an image-generation tool for these illustrations.`
}
