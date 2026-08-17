/**
 * Wire contract of the Cherry ↔ dsh-bridge side channel (a per-connection unix
 * socket / named pipe). Single source shared by the plugin (dsh subprocess) and
 * the driver (Cherry main).
 *
 * Framing and request/response correlation ride dsh's own `JsonRpcLineTransport`
 * (`@deepseek-ai/dsh-sdk-protocol`, pinned to the same version at both ends), so
 * both channels of the subprocess share one wire model. The method vocabulary
 * stays Cherry-owned: dsh's `HarnessSdkRequestMap` is closed to three methods
 * and its server throws on anything else, so open / cancel / policy / context /
 * command / tool / approval have to live here.
 */

// Wire-safe by design (dsh keeps this subpath free of cordis imports), and pinned to
// the same rc at both ends — safe to put on the wire, unlike the wider ContentBlock.
import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'

export type {
  AskUserQuestionAnswer,
  AskUserQuestionAnswerItem,
  AskUserQuestionItem
} from '@deepseek-ai/dsh-user-questions/types'

export const BRIDGE_SOCKET_ENV = 'CHERRY_DSH_BRIDGE_SOCK'
export const BRIDGE_TOKEN_ENV = 'CHERRY_DSH_BRIDGE_TOKEN'

export type BridgePermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

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
  /**
   * The only tools executable while plan mode is active, beyond contained reads.
   * Host-computed closed list (dsh plan mode enforces nothing itself) — notably it
   * must exclude the subagent tools, which would delegate around read-only.
   */
  planSafeTools: string[]
}

/** One continuable child in the durable catalog (`subagent/list`). */
export interface BridgeSubagentChild {
  id: string
  label: string
  /** `ready` = exists only in storage; resumable, not terminal. */
  status: 'running' | 'idle' | 'ready'
}

/** `ctx.tokenMeter.measure()` pressure plus the optional heuristic breakdown projection. */
export interface BridgeContextUsage {
  totalTokens: number
  systemTokens?: number
  toolsTokens?: number
  messageTokens?: number
}

/** `handled: false` = not a registered command (admission miss) — a success, not an error:
 *  the host falls back to prompting the line as prose. `kind`/`text` relay `command/done`. */
export interface BridgeCommandResult {
  handled: boolean
  kind?: 'success' | 'error'
  text?: string
}

/** Host→plugin request methods with their param and result shapes. */
export interface BridgeHostRequestMap {
  'session/open': {
    params: {
      sessionId: string
      provider: string
      model: string
      maxTokens?: number
      cwd: string
      resume: boolean
      policy: BridgePolicy
      tools: BridgeToolDescriptor[]
    }
    result: Record<string, never>
  }
  'session/prompt': {
    params: { sessionId: string; contentBlocks: BridgeTextBlock[] }
    result: Record<string, never>
  }
  'session/cancel': { params: { sessionId: string }; result: Record<string, never> }
  'policy/update': { params: { sessionId: string; policy: BridgePolicy }; result: Record<string, never> }
  'context/usage': { params: { sessionId: string }; result: BridgeContextUsage }
  /** One slash-command line dispatched through the runtime's `ctx.commands` registry. */
  'command/execute': { params: { sessionId: string; line: string }; result: BridgeCommandResult }
  /** Select plan mode; `outcome` relays `ctx.planMode.set` (`queued` while a turn is open). */
  'plan/set': {
    params: { sessionId: string; active: boolean }
    result: { outcome: 'committed' | 'queued' | 'cancelled' | 'noop' }
  }
  /** Stop one child's current turn on the user's behalf; an absent child is an accepted no-op. */
  'subagent/interrupt': { params: { sessionId: string; childSessionId: string }; result: Record<string, never> }
  /** Durable continuable-child catalog of one session, for task-list rebuild on reconnect. */
  'subagent/list': { params: { sessionId: string }; result: { children: BridgeSubagentChild[] } }
}

/** Plugin→host request methods. `ready` is the authentication handshake and MUST be first. */
export interface BridgePluginRequestMap {
  ready: { params: { pid: number; token: string }; result: Record<string, never> }
  'approval/ask': {
    params: { sessionId: string; toolName: string; callId?: string; args?: unknown; reason?: string }
    result: { outcome: 'allowed-once' | 'rejected' }
  }
  'tool/call': {
    /** `sessionId` is always the root session id — the host rejects child session ids. */
    params: { sessionId: string; callId: string; name: string; args: unknown }
    result: BridgeToolCallResult
  }
  /** One `ctx.userQuestions` ask (today only plan review reaches it) relayed to the host UI. */
  'question/ask': {
    params: { sessionId: string; questions: AskUserQuestionItem[] }
    result: AskUserQuestionAnswer
  }
}

/** Plugin→host notifications. JSON-RPC has no cancel, so `tool/cancel` carries the
 *  bridge's own `callId` (independent of the transport's request id). */
export interface BridgeNotificationMap {
  'tool/cancel': { sessionId: string; callId: string }
  /**
   * One subagent residency epoch's start or terminal edge (`ctx.on('subagent/start'|'end')`).
   * Fires per epoch — a continuable child cold-resumed by `send_message` starts a new epoch —
   * which is why the host keys its lineage admission on this rather than the SDK wire's
   * `subagent.started` (whose pairs are not 1:1).
   */
  'subagent/lifecycle': {
    phase: 'start' | 'end'
    runId: string
    childSessionId: string
    parentSessionId: string
    provider: string
    /** Present on `end`: `completed` | `aborted` | `error` | `max-tokens` | `refusal` | future variants. */
    stopReason?: string
  }
}

export type BridgeHostParams<M extends keyof BridgeHostRequestMap> = BridgeHostRequestMap[M]['params']
