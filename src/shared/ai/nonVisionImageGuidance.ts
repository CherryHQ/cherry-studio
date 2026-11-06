export const NON_VISION_IMAGE_GUIDANCE =
  "The selected model isn't configured for image input, and Cherry Studio couldn't extract readable text from the attachment. Enable Vision for this model in Provider Settings, choose another vision-capable model, or remove the image and try again."

/** Whole-text, case-insensitive match for the app-owned guidance above. */
export function isNonVisionImageGuidance(text: unknown): boolean {
  return typeof text === 'string' && text.trim().toLowerCase() === NON_VISION_IMAGE_GUIDANCE.trim().toLowerCase()
}
