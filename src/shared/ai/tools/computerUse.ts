import * as z from 'zod'

export const COMPUTER_USE_APP_META_KEY = 'com.cherrystudio.computer-use/app'

const computerUseAppSchema = z.object({
  name: z.string().min(1),
  bundleIdentifier: z.string().optional(),
  icon: z
    .object({
      mimeType: z.literal('image/png'),
      data: z.base64().min(1).max(65536)
    })
    .optional()
})

const computerUseResultSchema = z.object({
  _meta: z.object({ [COMPUTER_USE_APP_META_KEY]: computerUseAppSchema })
})

export function getComputerUseApp(output: unknown) {
  const result = computerUseResultSchema.safeParse(output)
  return result.success ? result.data._meta[COMPUTER_USE_APP_META_KEY] : undefined
}
