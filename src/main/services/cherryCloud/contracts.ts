import { ENDPOINT_TYPE, objectValues } from '@cherrystudio/provider-registry'
import { CHERRY_CLOUD_MODEL_FEATURE } from '@shared/data/presets/cherryai'
import * as z from 'zod'

const base64Url32BytesSchema = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)
const utcDateTimeSchema = z.iso.datetime()

function isSecureOrLoopbackUrl(value: string): boolean {
  const url = new URL(value)
  if (url.username || url.password) return false
  if (url.protocol === 'https:') return true
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  )
}

export const createDesktopAuthorizationResponseSchema = z.looseObject({
  authorization_id: z.uuid(),
  authorization_url: z.url().refine(isSecureOrLoopbackUrl, 'Authorization URL must use HTTPS or loopback HTTP'),
  expires_at: utcDateTimeSchema
})

const tokenSetSchema = z.looseObject({
  token_type: z.literal('Bearer'),
  access_token: base64Url32BytesSchema,
  expires_in: z.number().int().positive(),
  refresh_token: base64Url32BytesSchema,
  session_id: z.uuid(),
  session_expires_at: utcDateTimeSchema
})

const entitlementSchema = z.looseObject({
  plan_id: z.uuid(),
  plan_name: z.string().min(1),
  is_free: z.boolean(),
  status: z.enum(['inactive', 'active', 'expired']),
  model_ids: z.array(z.string().min(1))
})

const quotaPoolSchema = z.looseObject({
  model_ids: z.array(z.string().min(1)),
  windows: z.array(z.looseObject({ remaining_units: z.number().int().nonnegative() })).min(1)
})

export const accountSnapshotSchema = z.looseObject({
  account: z.looseObject({
    id: z.uuid(),
    display_name: z.string().min(1).optional()
  }),
  session: z.looseObject({
    id: z.uuid(),
    expires_at: utcDateTimeSchema
  }),
  device: z.looseObject({
    id: z.uuid()
  }),
  entitlements: z.array(entitlementSchema).default([]),
  quota_pools: z.array(quotaPoolSchema).default([])
})

export const exchangeDesktopAuthorizationResponseSchema = z.looseObject({
  token_set: tokenSetSchema,
  account: accountSnapshotSchema
})

export const refreshProductSessionResponseSchema = z.looseObject({
  token_set: tokenSetSchema
})

const cloudModelFeatureSchema = z.enum(objectValues(CHERRY_CLOUD_MODEL_FEATURE))
const cloudModelFeaturesSchema = z
  .array(cloudModelFeatureSchema)
  .min(1)
  .max(objectValues(CHERRY_CLOUD_MODEL_FEATURE).length)
  .refine((features) => new Set(features).size === features.length, {
    message: 'model features must be unique'
  })

export const cloudModelListSchema = z.looseObject({
  data: z.array(
    z.looseObject({
      id: z.string().min(1),
      display_name: z.string().min(1),
      endpoint_type: z.enum(objectValues(ENDPOINT_TYPE)),
      context_window: z.number().int().positive(),
      max_output_tokens: z.number().int().positive(),
      available_features: cloudModelFeaturesSchema
    })
  )
})
