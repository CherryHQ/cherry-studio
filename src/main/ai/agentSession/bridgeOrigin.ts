/**
 * Invocation provenance for bridged runtime tool calls.
 *
 * A runtime connection reuses one root Session identity for every descendant that calls a
 * Cherry tool (dsh-bridge resolves a delegated child back to its root session id), so a
 * session-id-only authorization check cannot tell a detached child's call from the
 * foreground turn's. These helpers let the caller name the *originating* execution — the
 * task/child whose turn spawned the work — so authorization and consent resolve against
 * that origin instead of whatever turn happens to be live now.
 */

/** MCP `tools/call` `_meta` key carrying the originating execution id for one invocation. */
export const BRIDGE_ORIGIN_META_KEY = 'cherry.bridgeOrigin'

/** An originating execution a bridged call belongs to, or the root turn itself. */
export type BridgeOrigin = string | undefined

/** Read the originating execution id off one `tools/call` request's `_meta`. */
export function readBridgeOriginMeta(meta: unknown): BridgeOrigin {
  if (typeof meta !== 'object' || meta === null) return undefined
  const origin = (meta as Record<string, unknown>)[BRIDGE_ORIGIN_META_KEY]
  return typeof origin === 'string' && origin ? origin : undefined
}

/** Attach the originating execution id to one outbound `tools/call` request. */
export function withBridgeOriginMeta(origin: BridgeOrigin): { [BRIDGE_ORIGIN_META_KEY]: string } | undefined {
  return origin === undefined ? undefined : { [BRIDGE_ORIGIN_META_KEY]: origin }
}
