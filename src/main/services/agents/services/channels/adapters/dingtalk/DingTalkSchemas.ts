/**
 * Zod schemas for every DingTalk HTTP response and stream payload we parse.
 *
 * External payloads can drift, so validate at the boundary with safeParse and
 * fail soft. Schemas are intentionally permissive (`.loose()`) so unknown
 * keys pass through and the adapter keeps working.
 */
import * as z from 'zod'

/**
 * Accept a JSON-encoded string and return the parsed JS value. Compose with
 * `.pipe(<schema>)` so a single `safeParse` covers both "not JSON" and
 * "wrong shape" failure modes.
 */
export const JsonStringSchema = z.string().transform((value, ctx) => {
  try {
    return JSON.parse(value) as unknown
  } catch (err) {
    ctx.issues.push({
      code: 'custom',
      message: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      input: value
    })
    return z.NEVER
  }
})

// ---- OAuth token: POST /v1.0/oauth2/accessToken ----

export const DingTalkTokenResponseSchema = z
  .object({
    accessToken: z.string().optional(),
    expireIn: z.number().optional(),
    code: z.string().optional(),
    message: z.string().optional()
  })
  .loose()

// ---- Media download metadata: POST /v1.0/robot/messageFiles/download ----

export const DingTalkMediaDownloadResponseSchema = z
  .object({
    downloadUrl: z.string().optional()
  })
  .loose()

// ---- Session webhook ack (most responses are empty or { errcode, errmsg }) ----

export const DingTalkSessionAckSchema = z
  .object({
    errcode: z.number().optional(),
    errmsg: z.string().optional()
  })
  .loose()

// ---- Device Flow: POST /app/registration/{init,begin,poll} ----

export const DingTalkRegistrationEnvelopeSchema = z
  .object({
    errcode: z.union([z.number(), z.string()]).optional(),
    errmsg: z.string().optional()
  })
  .loose()

export const DingTalkRegistrationInitResponseSchema = DingTalkRegistrationEnvelopeSchema.extend({
  nonce: z.string().optional()
})

export const DingTalkRegistrationBeginResponseSchema = DingTalkRegistrationEnvelopeSchema.extend({
  device_code: z.string().optional(),
  verification_uri_complete: z.string().optional(),
  expires_in: z.number().optional(),
  interval: z.number().optional()
})

export const DingTalkRegistrationPollResponseSchema = DingTalkRegistrationEnvelopeSchema.extend({
  status: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  fail_reason: z.string().optional()
})

// ---- Inbound stream message: DWClient callback `downstream.data` (JSON string) ----

export const DingTalkInboundMessageSchema = z
  .object({
    msgId: z.string().optional(),
    msgtype: z.string().optional(),
    conversationType: z.string().optional(),
    conversationId: z.string().optional(),
    senderId: z.string().optional(),
    senderStaffId: z.string().optional(),
    senderNick: z.string().optional(),
    sessionWebhook: z.string().optional(),
    text: z
      .object({
        content: z.string().optional()
      })
      .loose()
      .optional(),
    content: z
      .object({
        downloadCode: z.string().optional(),
        fileName: z.string().optional(),
        recognition: z.string().optional()
      })
      .loose()
      .optional()
  })
  .loose()
