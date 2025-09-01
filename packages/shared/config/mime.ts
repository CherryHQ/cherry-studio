import z from 'zod/v4'

const imageMimeSchema = z.union([
  z.literal('image/jpeg'),
  z.literal('image/png'),
  z.literal('image/gif'),
  z.literal('image/webp')
])

export type ImageMimeType = z.infer<typeof imageMimeSchema>

export const isImageMimeType = (mime: string): mime is ImageMimeType => {
  return imageMimeSchema.safeParse(mime).success
}
