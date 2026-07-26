import * as z from 'zod'

export const GENERATE_IMAGE_TOOL_NAME = 'generate_image'

export const generateImageOutputItemSchema = z.object({
  id: z.string().describe('File entry id of the generated image.'),
  name: z.string().describe('File name of the generated image.')
})

export const generateImageOutputSchema = z.array(generateImageOutputItemSchema)

export type GenerateImageOutputItem = z.infer<typeof generateImageOutputItemSchema>
export type GenerateImageOutput = z.infer<typeof generateImageOutputSchema>
