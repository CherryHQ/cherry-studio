import { realpath } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import type { ApprovalHostFacts } from '@cherrystudio/agent-behavior'
import type { JsonValue } from '@cherrystudio/agent-runtime'
import { BUILTIN_AGENT_TOOL_GUARD_RULES } from '@main/ai/agents/builtin/builtinAgentGuardRules'
import { resolveBrowserToolPermission } from '@main/ai/toolApproval/browserToolPolicy'
import { evaluateCommandPolicy } from '@main/ai/toolApproval/commandPolicy'
import { detectGlobalInstall, detectMiseMutation } from '@main/ai/toolApproval/dependencyGuard'
import type { ToolGuardInteractionState } from '@main/ai/toolApproval/toolGuards'
import { evaluateToolGuards } from '@main/ai/toolApproval/toolGuards'
import { evaluateUserDataSqliteGuard, normalizePiNativePathInput } from '@main/ai/toolApproval/userDataSqliteGuard'
import { t } from '@main/i18n'
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
  builtinRole?: string
  shellDialect?: string
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
  const command = (name === 'bash' || name === 'powershell') && typeof input.command === 'string' ? input.command : ''
  const globalInstall = command ? (detectGlobalInstall(command) ?? undefined) : undefined
  const miseMutation = command ? (detectMiseMutation(command) ?? undefined) : undefined
  const rewritten =
    name === 'bash' && !disabled && !sqlite && !globalInstall && !miseMutation && command
      ? await rtkRewrite(command)
      : undefined
  const dialect = name === 'powershell' ? 'powershell' : (ctx.shellDialect ?? 'bash')
  const roles = ctx.builtinRole ? [ctx.builtinRole] : []
  let commandPolicy =
    command && !disabled
      ? await evaluateCommandPolicy({ command, dialect, cwd: ctx.workspacePath, builtinRoles: roles })
      : undefined
  if (commandPolicy && rewritten && rewritten !== command) {
    const effective = await evaluateCommandPolicy({
      command: rewritten,
      dialect,
      cwd: ctx.workspacePath,
      builtinRoles: roles
    })
    if (effective.effect === 'deny' || (effective.effect === 'ask' && commandPolicy.effect === 'allow'))
      commandPolicy = effective
  }
  const guard = ctx.builtinRole
    ? await evaluateToolGuards(BUILTIN_AGENT_TOOL_GUARD_RULES, {
        toolName: name === 'bash' || name === 'powershell' ? 'Bash' : name,
        input,
        permissionMode: mode,
        builtinRole: ctx.builtinRole,
        mountedServers: new Set(),
        pluginDirectories: new Map(),
        cwd: ctx.workspacePath,
        agentDataPath: ctx.agentDataPath,
        interaction,
        isDisabled: ctx.isDisabled
      })
    : undefined
  const denial =
    commandPolicy?.effect === 'deny' ? commandPolicy.reason : guard?.effect === 'deny' ? guard.reason : undefined
  const policyAsk = commandPolicy?.effect === 'ask'
  const policyDetails = commandPolicy
    ? {
        cwd: ctx.workspacePath,
        revision: commandPolicy.revision,
        reason:
          guard?.reason ??
          commandPolicy.reason ??
          (globalInstall ? t('command_approval.dependency_install') : t('command_approval.permission_required')),
        rules: commandPolicy.hits.map(({ ruleId, reasonCode, evidence }) => ({ ruleId, reasonCode, evidence }))
      }
    : undefined
  return {
    category,
    disabled,
    autoApproved: browser === 'allow' || ctx.autoApprovedTools.has(name),
    approvalRequired: ctx.approvalRequiredTools.has(name) || (policyAsk && mode === 'auto') || guard?.effect === 'ask',
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
    miseMutation,
    ...(globalInstall ? { globalInstallPermissionMode: ctx.getPermissionMode() ?? 'default' } : {}),
    destructive: policyAsk,
    ...(denial ? { commandPolicyDenial: denial } : {}),
    ...(policyDetails
      ? {
          approvalDetails: policyDetails,
          policyContext: JSON.stringify([ctx.workspacePath, dialect, roles, mode, commandPolicy?.revision]),
          policyChangedReason: t('command_approval.context_changed')
        }
      : {}),
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
