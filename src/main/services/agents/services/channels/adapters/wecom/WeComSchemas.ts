/**
 * Zod schemas for every WeCom HTTP response we parse.
 *
 * External payloads can drift, so we validate them at the boundary and fail
 * soft (return null / throw a typed error) rather than `as`-casting into the
 * consumer. Keep schemas permissive — unknown fields pass through — but
 * require the keys the adapter relies on.
 */
import * as z from 'zod'

/**
 * Accept a JSON-encoded string and return the parsed JS value. Use with
 * `.pipe(<schema>)` so a single `safeParse` call covers both "not JSON" and
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

// ---- Bootstrap: POST /cgi-bin/aibot/cli/get_mcp_config ----

export const McpConfigItemSchema = z
  .object({
    url: z.string().optional(),
    type: z.string().optional(),
    is_authed: z.boolean().optional(),
    biz_type: z.string().optional()
  })
  .loose()

export const GetMcpConfigResponseSchema = z
  .object({
    errcode: z.number(),
    errmsg: z.string().optional(),
    list: z.array(McpConfigItemSchema).optional()
  })
  .loose()

// ---- JSON-RPC envelope for tool calls ----

export const JsonRpcContentItemSchema = z
  .object({
    type: z.string().optional(),
    text: z.string().optional()
  })
  .loose()

export const JsonRpcResultSchema = z
  .object({
    isError: z.boolean().optional(),
    content: z.array(JsonRpcContentItemSchema).optional()
  })
  .loose()

export const JsonRpcErrorSchema = z
  .object({
    code: z.number().optional(),
    message: z.string().optional(),
    data: z.unknown().optional()
  })
  .loose()

export const JsonRpcResponseSchema = z
  .object({
    jsonrpc: z.string().optional(),
    id: z.string().optional(),
    result: JsonRpcResultSchema.optional(),
    error: JsonRpcErrorSchema.optional()
  })
  .loose()

// ---- Generic business response (errcode 0 success contract) ----

export const BizResponseSchema = z
  .object({
    errcode: z.number().optional(),
    errmsg: z.string().optional()
  })
  .loose()

// ---- msg.get_msg_chat_list ----

export const MsgChatListItemSchema = z
  .object({
    chat_id: z.string(),
    chat_name: z.string().optional(),
    last_msg_time: z.string().optional(),
    msg_count: z.number().optional()
  })
  .loose()

export const GetMsgChatListResponseSchema = BizResponseSchema.extend({
  chats: z.array(MsgChatListItemSchema).optional(),
  has_more: z.boolean().optional(),
  next_cursor: z.string().optional()
})

// ---- msg.get_message ----

export const WeComMessageItemSchema = z
  .object({
    userid: z.string().optional(),
    send_time: z.string().optional(),
    msgtype: z.enum(['text', 'image', 'file', 'voice', 'video']).optional(),
    text: z.object({ content: z.string().optional() }).loose().optional(),
    image: z.object({ media_id: z.string().optional(), name: z.string().optional() }).loose().optional(),
    file: z.object({ media_id: z.string().optional(), name: z.string().optional() }).loose().optional(),
    voice: z.object({ media_id: z.string().optional(), name: z.string().optional() }).loose().optional(),
    video: z.object({ media_id: z.string().optional(), name: z.string().optional() }).loose().optional()
  })
  .loose()

export const GetMessageResponseSchema = BizResponseSchema.extend({
  messages: z.array(WeComMessageItemSchema).optional(),
  next_cursor: z.string().optional()
})

// ---- msg.get_msg_media ----

export const MediaItemSchema = z
  .object({
    media_id: z.string().optional(),
    name: z.string().optional(),
    type: z.enum(['image', 'file', 'voice', 'video']).optional(),
    size: z.number().optional(),
    content_type: z.string().optional(),
    base64_data: z.string().optional()
  })
  .loose()

export const GetMsgMediaResponseSchema = BizResponseSchema.extend({
  media_item: MediaItemSchema.optional()
})

// ---- QR registration (work.weixin.qq.com/ai/qc/*) ----

export const QrGenerateResponseSchema = z
  .object({
    data: z
      .object({
        scode: z.string().optional(),
        auth_url: z.string().optional()
      })
      .loose()
      .optional()
  })
  .loose()

export const QrQueryResponseSchema = z
  .object({
    data: z
      .object({
        status: z.string().optional(),
        bot_info: z
          .object({
            botid: z.string().optional(),
            secret: z.string().optional()
          })
          .loose()
          .optional()
      })
      .loose()
      .optional()
  })
  .loose()
