import { realpath } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import type { ApprovalHostFacts } from '@cherrystudio/agent-behavior'
import type { JsonValue } from '@cherrystudio/agent-runtime'
import { resolveBrowserToolPermission } from '@main/ai/toolApproval/browserToolPolicy'
import { detectGlobalInstall } from '@main/ai/toolApproval/dependencyGuard'
import { detectDestructiveCommand } from '@main/ai/toolApproval/destructiveCommand'
import type { ToolGuardInteractionState } from '@main/ai/toolApproval/toolGuards'
import { evaluateUserDataSqliteGuard, normalizePiNativePathInput } from '@main/ai/toolApproval/userDataSqliteGuard'
import { canonicalizePathForContainment } from '@main/utils/file'
import { rtkRewrite } from '@main/utils/rtk'
import { PI_BUILTIN_TOOLS } from '@shared/ai/piBuiltinTools'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'

export interface PiApprovalContext {
  sessionId: string
  workspacePath: string
  agentDataPath: string
  additionalReadOnlyRoots: readonly string[]
  getInteractionState(): ToolGuardInteractionState
  getPermissionMode(): AgentPermissionMode | undefined
  isDisabled(toolName: string): boolean
  autoApprovedTools: ReadonlySet<string>
  approvalRequiredTools: ReadonlySet<string>
  nonBypassableApprovalTools: ReadonlySet<string>
  delegationTools: ReadonlySet<string>
}

const BEHAVIOR_META_TOOLS = new Set([
  'AskUserQuestion',
  'todo_write',
  'get_goal',
  'create_goal',
  'update_goal',
  'subagent',
  'message_subagent',
  'stop_subagent'
])

/** Gather environment facts; the shared behavior gate decides whether the call may run. */
export async function readPiApprovalFacts(
  ctx: PiApprovalContext,
  name: string,
  input: Record<string, JsonValue>
): Promise<ApprovalHostFacts> {
  const browser = resolveBrowserToolPermission(name)
  const permissionClass = PI_BUILTIN_TOOLS.find((tool) => tool.name === name)?.permissionClass
  const category = BEHAVIOR_META_TOOLS.has(name)
    ? 'meta'
    : permissionClass === 'read' || permissionClass === 'edit' || permissionClass === 'meta'
      ? permissionClass
      : 'other'
  const interaction = ctx.getInteractionState()
  const mode = ctx.getPermissionMode() ?? 'default'
  const disabled = ctx.isDisabled(name) || browser === 'deny'
  const sqlite = disabled
    ? undefined
    : await evaluateUserDataSqliteGuard({
        runtime: 'pi',
        toolName: name,
        args: input,
        cwd: ctx.workspacePath,
        workspacePath: ctx.workspacePath
      })
  const command = name === 'bash' && typeof input.command === 'string' ? input.command : ''
  const globalInstall = command ? (detectGlobalInstall(command) ?? undefined) : undefined
  const rewritten = !disabled && !sqlite && !globalInstall && command ? await rtkRewrite(command) : undefined
  return {
    category,
    disabled,
    autoApproved: browser === 'allow' || ctx.autoApprovedTools.has(name),
    approvalRequired: ctx.approvalRequiredTools.has(name),
    nonBypassable: ctx.nonBypassableApprovalTools.has(name),
    withinAllowedRoots:
      (category === 'read' || category === 'edit') &&
      (await isToolPathInsideAllowedRoots(
        input,
        ctx.workspacePath,
        ctx.agentDataPath,
        mode === 'auto' || category === 'edit',
        category === 'read' ? ctx.additionalReadOnlyRoots : []
      )),
    sqliteGuard: sqlite?.reason,
    globalInstall,
    destructive: Boolean(command && detectDestructiveCommand(command)),
    ...(rewritten ? { rewrittenArgs: { ...input, command: rewritten } } : {}),
    ...(ctx.delegationTools.has(name)
      ? {
          delegation:
            interaction.currentTurn === 'headless' || interaction.userResponse === 'unavailable'
              ? ('unattended' as const)
              : ('interactive' as const)
        }
      : {})
  }
}

async function isToolPathInsideAllowedRoots(
  input: Record<string, JsonValue>,
  workspacePath: string,
  agentDataPath: string,
  allowMissingTarget: boolean,
  additionalAllowedRoots: readonly string[] = []
): Promise<boolean> {
  const raw = input.path
  // read defaults a missing/empty path to "." → the workspace root, which is inside.
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return false

  const resolved = resolveToolPath(raw || '.', workspacePath)
  if (resolved === undefined) return false

  const [canonicalWorkspace, canonicalAgentData, canonicalTarget] = await Promise.all([
    canonicalizeExistingPath(workspacePath),
    canonicalizeExistingPath(agentDataPath),
    canonicalizePathForContainment(resolved, { allowMissing: allowMissingTarget })
  ])
  if (!canonicalWorkspace || !canonicalAgentData || !canonicalTarget) return false

  const canonicalAdditionalRoots = (
    await Promise.all(additionalAllowedRoots.map((root) => canonicalizeExistingPath(root)))
  ).filter((root): root is string => root !== undefined)

  return [canonicalWorkspace, canonicalAgentData, ...canonicalAdditionalRoots].some((root) => {
    const rel = path.relative(root, canonicalTarget)
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
  })
}

async function canonicalizeExistingPath(target: string): Promise<string | undefined> {
  try {
    return await realpath(target)
  } catch {
    return undefined
  }
}

/** Resolve a raw tool `path` to an absolute path, mirroring pi's `resolveToCwd`; returns undefined
 *  for inputs whose resolution is ambiguous (e.g. `file://` URLs) so the caller requires approval. */
function resolveToolPath(raw: string, workspacePath: string): string | undefined {
  let p = normalizePiNativePathInput(raw)
  if (p === '~') p = application.getPath('sys.home')
  else if (p.startsWith('~/') || (process.platform === 'win32' && p.startsWith('~\\'))) {
    p = path.join(application.getPath('sys.home'), p.slice(2))
  } else if (p.startsWith('file://')) {
    // pi resolves file:// via fileURLToPath; the target can be anywhere, so stay conservative.
    return undefined
  }
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(workspacePath, p)
}
