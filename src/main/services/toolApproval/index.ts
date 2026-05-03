/**
 * Public entry point for the unified tool-approval system.
 *
 * Production callers (tool `needsApproval` hooks, the `addToolApprovalResponse`
 * dispatcher, etc.) should use `checkPermission(...)` from this module —
 * it threads the singleton `matcherRegistry` and the global tool registry
 * automatically. Tests bypass this and call the dep-injected
 * `checkToolPermission` from `./checkPermission` directly.
 */

import { registry as toolRegistry } from '@main/ai/tools/registry'

import { checkToolPermission as checkToolPermissionWithDeps } from './checkPermission'
import { matcherRegistry } from './matcher'
import type { PermissionContext, PermissionDecision } from './types'

export { shouldAutoApprove } from './autoApprovePolicy'
export { matcherRegistry } from './matcher'

export async function checkPermission(
  toolName: string,
  input: unknown,
  ctx: PermissionContext
): Promise<PermissionDecision> {
  return checkToolPermissionWithDeps(toolName, input, ctx, { matcherRegistry, toolRegistry })
}
