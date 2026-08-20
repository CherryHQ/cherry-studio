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

export const createDesktopAuthorizationResponseSchema = z.strictObject({
  authorization_id: z.uuid(),
  authorization_url: z.url().refine(isSecureOrLoopbackUrl, 'Authorization URL must use HTTPS or loopback HTTP'),
  expires_at: utcDateTimeSchema
})

const tokenSetSchema = z.strictObject({
  token_type: z.literal('Bearer'),
  access_token: base64Url32BytesSchema,
  expires_in: z.number().int().positive(),
  refresh_token: base64Url32BytesSchema,
  session_id: z.uuid(),
  session_expires_at: utcDateTimeSchema
})

const accountSnapshotSchema = z.looseObject({
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
  })
})

export const exchangeDesktopAuthorizationResponseSchema = z.strictObject({
  token_set: tokenSetSchema,
  account: accountSnapshotSchema
})

export const storedCherryCloudStateSchema = z.strictObject({
  version: z.literal(1),
  device: z
    .strictObject({
      publicKey: base64Url32BytesSchema,
      privateKey: z.string().min(1)
    })
    .nullable(),
  pending: z
    .strictObject({
      authorizationId: z.uuid(),
      state: base64Url32BytesSchema,
      codeVerifier: z
        .string()
        .min(43)
        .max(128)
        .regex(/^[A-Za-z0-9._~-]+$/),
      expiresAt: utcDateTimeSchema
    })
    .nullable(),
  session: z
    .strictObject({
      accessToken: base64Url32BytesSchema,
      accessExpiresAt: utcDateTimeSchema,
      refreshToken: base64Url32BytesSchema,
      sessionId: z.uuid(),
      sessionExpiresAt: utcDateTimeSchema,
      deviceId: z.uuid(),
      accountId: z.uuid(),
      displayName: z.string().nullable()
    })
    .nullable()
})

export type StoredCherryCloudState = z.infer<typeof storedCherryCloudStateSchema>

export const EMPTY_STORED_CHERRY_CLOUD_STATE: StoredCherryCloudState = {
  version: 1,
  device: null,
  pending: null,
  session: null
}
