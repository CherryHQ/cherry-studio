/**
 * WeCom (企业微信) MCP JSON-RPC request/response types.
 *
 * The wire format is documented in the wecom-cli Rust source:
 *   - Bootstrap:  src/mcp/config.rs
 *   - JSON-RPC:   src/json_rpc.rs
 *   - Tools:      skills/wecomcli-msg/references/*.md
 */

/** chat_type 1 = single-user DM, 2 = group chat. */
export type WeComChatType = 1 | 2

/** Bootstrap request to `qyapi.weixin.qq.com/cgi-bin/aibot/cli/get_mcp_config`. */
export interface GetMcpConfigRequest {
  bot_id: string
  time: number
  nonce: string
  signature: string
  bind_source: 1 | 2 // 1 = Interactive (manual creds), 2 = QR
  cli_version: string
}

export interface McpConfigItem {
  url?: string
  type?: string
  is_authed?: boolean
  biz_type?: string
}

export interface GetMcpConfigResponse {
  errcode: number
  errmsg?: string
  list?: McpConfigItem[]
}

/** JSON-RPC 2.0 envelope. */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc?: '2.0'
  id?: string
  result?: {
    isError?: boolean
    content?: Array<{ type?: string; text?: string }>
  }
  error?: { code?: number; message?: string; data?: unknown }
}

/** Business-layer response shape (the JSON inside `result.content[0].text`). */
export interface BizResponse {
  errcode?: number
  errmsg?: string
  [k: string]: unknown
}

// ---- msg.* tool I/O shapes ----

export interface GetMsgChatListArgs {
  begin_time: string
  end_time: string
  cursor?: string
}

export interface MsgChatListItem {
  chat_id: string
  chat_name?: string
  last_msg_time?: string
  msg_count?: number
}

export interface GetMsgChatListResponse extends BizResponse {
  chats?: MsgChatListItem[]
  has_more?: boolean
  next_cursor?: string
}

export interface GetMessageArgs {
  chat_type: WeComChatType
  chatid: string
  begin_time: string
  end_time: string
  cursor?: string
}

export type WeComMessageType = 'text' | 'image' | 'file' | 'voice' | 'video'

export interface WeComMessageItem {
  userid?: string
  send_time?: string
  msgtype?: WeComMessageType
  text?: { content?: string }
  image?: { media_id?: string; name?: string }
  file?: { media_id?: string; name?: string }
  voice?: { media_id?: string; name?: string }
  video?: { media_id?: string; name?: string }
}

export interface GetMessageResponse extends BizResponse {
  messages?: WeComMessageItem[]
  next_cursor?: string
}

export interface GetMsgMediaArgs {
  media_id: string
}

export interface MediaItem {
  media_id?: string
  name?: string
  type?: 'image' | 'file' | 'voice' | 'video'
  size?: number
  content_type?: string
  /** Base64-encoded payload (returned by the MCP server before CLI interception). */
  base64_data?: string
}

export interface GetMsgMediaResponse extends BizResponse {
  media_item?: MediaItem
}

export interface SendMessageArgs {
  chat_type: WeComChatType
  chatid: string
  msgtype: 'text'
  text: { content: string }
}
