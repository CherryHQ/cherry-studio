import * as z from 'zod'

import { THEME_IMAGE_BYTE_LIMIT, THEME_IMAGE_TYPES } from '@shared/types/marketplaceTheme'

import { defineRoute } from '../define'
import { uint8ArraySchema } from './common'

const themeSchema = z.object({
  id: z.string(),
  name: z.string(),
  author: z.string(),
  description: z.string(),
  version: z.string(),
  code: z.string(),
  cdn_link: z.string(),
  title: z.array(z.string()),
  light_mode: z.boolean(),
  dark_mode: z.boolean(),
  light_pic: z.string(),
  dark_pic: z.string()
})

export type MarketplaceTheme = z.infer<typeof themeSchema>
export const themePageSchema = z.object({ items: z.array(themeSchema), total: z.number().int().nonnegative() })

const previewFile = z.object({
  name: z.string().min(1),
  type: z.enum(THEME_IMAGE_TYPES),
  bytes: uint8ArraySchema.refine((bytes) => bytes.byteLength > 0 && bytes.byteLength < THEME_IMAGE_BYTE_LIMIT)
})

export const themeRequestSchemas = {
  'theme.marketplace.submit': defineRoute({
    input: z.object({
      key: z.uuid(),
      name: z.string().trim().min(1),
      author: z.string().trim().min(1),
      version: z.string().regex(/^\d+(\.\d+)*$/),
      code: z.string().refine((code) => Boolean(code.trim())),
      cdn_link: z.union([z.literal(''), z.httpUrl()]),
      title: z.array(z.string().regex(/^[\w\u4e00-\u9fa5]+$/)),
      light_pic: previewFile.nullable(),
      dark_pic: previewFile.nullable()
    }),
    output: z.void()
  }),
  'theme.marketplace.list': defineRoute({
    input: z.object({
      offset: z.number().int().nonnegative(),
      limit: z.number().int().min(1).max(24),
      search: z.string(),
      author: z.string(),
      tag: z.string()
    }),
    output: themePageSchema
  })
}
