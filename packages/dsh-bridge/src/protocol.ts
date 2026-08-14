/**
 * Wire contract of the Cherry ↔ dsh-bridge side channel (newline-delimited JSON
 * over a per-connection unix socket / named pipe). Single source shared by the
 * plugin (dsh subprocess) and the driver (Cherry main).
 *
 * Framing mirrors dsh's own SDK stdio wire (one compact JSON frame per line) so
 * both channels of the subprocess share one debugging model. Deliberately NOT a
 * JSON-RPC 2.0 envelope: both peers are Cherry-owned, so the discriminated
 * `type` + `id` already carry method and correlation without the extra layer.
 */

export const BRIDGE_SOCKET_ENV = 'CHERRY_DSH_BRIDGE_SOCK'
export const BRIDGE_TOKEN_ENV = 'CHERRY_DSH_BRIDGE_TOKEN'

export type BridgePermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions'

/** Wire-owned on purpose — NOT dsh's TextBlock: the socket schema must not drift with an rc dep,
 *  and dsh's wider ContentBlock (image attachment refs are subprocess-local) cannot cross this wire. */
export interface BridgeTextBlock {
  type: 'text'
  text: string
}

export interface BridgeToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface BridgeToolCallResult {
  text: string
  data?: unknown
}

/** Data-driven policy state pushed by the host at open and on reconcile. */
export interface BridgePolicy {
  permissionMode: BridgePermissionMode
  disabledTools: string[]
  /** Canonical roots (workspace + agent data dir) inside which read/edit fast-paths apply. */
  allowedRoots: string[]
  /** dsh builtin tool names classified read-only (auto-approve inside roots, every mode). */
  readTools: string[]
  /** dsh builtin tool names classified edit (auto-approve inside roots under acceptEdits). */
  editTools: string[]
  /** First-party bridged tools that may run without a per-call approval. */
  autoApprovedTools: string[]
  /** Sensitive bridged tools that still require approval in bypass mode. */
  approvalRequiredTools: string[]
}

export type HostToBridgeMessage =
  | {
      type: 'open'
      id: string
      sessionId: string
      provider: string
      model: string
      maxTokens?: number
      cwd: string
      resume: boolean
      policy: BridgePolicy
      tools: BridgeToolDescriptor[]
    }
  | { type: 'prompt'; id: string; sessionId: string; contentBlocks: BridgeTextBlock[] }
  | { type: 'cancel'; id: string; sessionId: string }
  | { type: 'policyUpdate'; id: string; sessionId: string; policy: BridgePolicy }
  | { type: 'contextUsage'; id: string; sessionId: string }
  /** One slash-command line dispatched through the runtime's `ctx.commands` registry. */
  | { type: 'command'; id: string; sessionId: string; line: string }
  | { type: 'approvalAnswer'; id: string; outcome: 'allowed-once' | 'rejected' }
  | ({ type: 'toolCallResult'; id: string; ok: true } & BridgeToolCallResult)
  | { type: 'toolCallResult'; id: string; ok: false; error: string }

/** `ctx.tokenMeter.measure()` pressure plus the optional heuristic breakdown projection. */
export interface BridgeContextUsage {
  totalTokens: number
  systemTokens?: number
  toolsTokens?: number
  messageTokens?: number
}

export type BridgeToHostMessage =
  | { type: 'ready'; pid: number; token: string }
  | { type: 'result'; id: string; ok: boolean; error?: string }
  | { type: 'contextUsageResult'; id: string; ok: boolean; usage?: BridgeContextUsage; error?: string }
  /** `handled: false` = not a registered command (admission miss) — the host falls back to a prompt.
   *  `kind`/`text` relay the command's own `command/done` outcome for the host to present. */
  | {
      type: 'commandResult'
      id: string
      ok: boolean
      handled?: boolean
      kind?: 'success' | 'error'
      text?: string
      error?: string
    }
  | { type: 'toolCall'; id: string; sessionId: string; name: string; args: unknown }
  | { type: 'toolCallCancel'; id: string; sessionId: string }
  | {
      type: 'approvalAsk'
      id: string
      sessionId: string
      toolName: string
      callId?: string
      args?: unknown
      reason?: string
    }

export const encodeBridgeMessage = (msg: object): string => JSON.stringify(msg) + '\n'

/** Stateful newline-JSON decoder factory (handles split/coalesced TCP chunks). */
export function createBridgeFrameDecoder(onMessage: (msg: unknown) => void): (chunk: Buffer | string) => void {
  // Byte-level buffering: 0x0A never occurs inside a multibyte UTF-8 sequence,
  // so a chunk boundary mid-character cannot corrupt a decoded line.
  let buffer = Buffer.alloc(0)
  return (chunk) => {
    buffer = Buffer.concat([buffer, typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk])
    let newlineIndex: number
    while ((newlineIndex = buffer.indexOf(0x0a)) >= 0) {
      const line = buffer.subarray(0, newlineIndex).toString('utf8')
      buffer = buffer.subarray(newlineIndex + 1)
      if (!line.trim()) continue
      let msg: unknown
      try {
        msg = JSON.parse(line)
      } catch {
        continue // a malformed frame must not crash the peer's data handler
      }
      onMessage(msg)
    }
  }
}
