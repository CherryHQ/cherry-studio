import fs from 'node:fs'
import path from 'node:path'

import { extractLocalAcpRawInputCommand, extractLocalAcpRawInputPaths } from '@shared/ai/localAgent'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'

import { acpPreset } from './acpPresets'

export interface AcpPermissionToolLike {
  title?: string | null
  name?: string | null
  kind?: string | null
  locations?: ReadonlyArray<{ path?: string | null }> | null
  content?: ReadonlyArray<unknown> | null
  rawInput?: unknown
}

export interface AcpSessionPermissionGrants {
  allowWrite: boolean
  allowExecute: boolean
  allowedToolKeys: Set<string>
}

export function createAcpSessionPermissionGrants(): AcpSessionPermissionGrants {
  return {
    allowWrite: false,
    allowExecute: false,
    allowedToolKeys: new Set()
  }
}

/**
 * Symlink-aware containment check (walks missing suffix up to the deepest existing ancestor).
 * Fails closed on dangling symlinks or filesystem errors.
 */
function canonicalPathForContainment(candidatePath: string): string | undefined {
  let current = path.resolve(candidatePath)
  const missingSuffix: string[] = []

  while (true) {
    try {
      return path.resolve(fs.realpathSync.native(current), ...missingSuffix)
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
        return undefined
      }
    }

    try {
      fs.lstatSync(current)
      return undefined
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
        return undefined
      }
    }

    const parent = path.dirname(current)
    if (parent === current) return undefined
    missingSuffix.unshift(path.basename(current))
    current = parent
  }
}

export function isPathWithinWorkspace(targetPath: string, cwd: string): boolean {
  if (!targetPath || !cwd) return false

  const resolvedCwd = path.resolve(cwd)
  const resolvedTarget = path.resolve(resolvedCwd, targetPath)
  const canonicalCwd = canonicalPathForContainment(resolvedCwd)
  const canonicalTarget = canonicalPathForContainment(resolvedTarget)
  if (!canonicalCwd || !canonicalTarget) return false

  const relative = path.relative(canonicalCwd, canonicalTarget)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

export function classifyAcpToolKind(tool: AcpPermissionToolLike): 'read' | 'mutation' | 'execute' | 'other' {
  const kind = tool.kind?.trim().toLowerCase()
  if (kind === 'read' || kind === 'search' || kind === 'think') return 'read'
  if (kind === 'edit' || kind === 'delete' || kind === 'move' || kind === 'create' || kind === 'write') {
    return 'mutation'
  }
  if (kind === 'execute' || kind === 'terminal' || kind === 'shell' || kind === 'bash') return 'execute'

  if (
    tool.content?.some((item) => typeof item === 'object' && item !== null && 'type' in item && item.type === 'diff')
  ) {
    return 'mutation'
  }
  if (extractLocalAcpRawInputCommand(tool.rawInput)) return 'execute'
  return 'other'
}

export function getAcpToolGrantKey(tool: AcpPermissionToolLike): string | undefined {
  return (tool.name || tool.title)?.trim().toLowerCase() || undefined
}

export function extractAcpToolPaths(tool: AcpPermissionToolLike): string[] {
  const paths: string[] = []
  for (const location of tool.locations ?? []) {
    if (typeof location.path === 'string' && location.path.trim()) {
      paths.push(location.path)
    }
  }
  for (const item of tool.content ?? []) {
    if (typeof item === 'object' && item !== null && 'type' in item && item.type === 'diff' && 'path' in item) {
      if (typeof item.path === 'string' && item.path.trim()) {
        paths.push(item.path)
      }
    }
  }
  for (const rawPath of extractLocalAcpRawInputPaths(tool.rawInput)) {
    paths.push(rawPath)
  }
  return paths
}

/** Automatic approval must not persist a new permission in the external CLI. */
export function selectAutoAllowPermissionOption<T extends { optionId: string; kind: string }>(
  options: readonly T[]
): T | undefined {
  return options.find((option) => option.kind === 'allow_once')
}

export function evaluateAcpPermissionRequest({
  mode,
  tool,
  cwd,
  grants
}: {
  mode?: AgentPermissionMode
  tool: AcpPermissionToolLike
  cwd: string
  grants: AcpSessionPermissionGrants
}): 'allow' | 'ask' {
  if (mode === 'bypassPermissions') return 'allow'
  if (mode === 'plan') return 'ask'

  const kind = classifyAcpToolKind(tool)
  const paths = extractAcpToolPaths(tool)

  if (mode === 'acceptEdits' && kind === 'mutation') {
    return paths.length > 0 && paths.every((targetPath) => isPathWithinWorkspace(targetPath, cwd)) ? 'allow' : 'ask'
  }

  // Explicit user-granted session permissions apply across default, acceptEdits, and auto modes.
  if (kind === 'mutation' && grants.allowWrite) {
    return paths.length > 0 && paths.every((targetPath) => isPathWithinWorkspace(targetPath, cwd)) ? 'allow' : 'ask'
  }

  if (kind === 'execute' && grants.allowExecute) {
    return 'allow'
  }

  if (kind === 'read' || kind === 'other') {
    const key = getAcpToolGrantKey(tool)
    if (key && grants.allowedToolKeys.has(key)) return 'allow'
  }

  return 'ask'
}

export function recordAcpAlwaysAllowGrant(grants: AcpSessionPermissionGrants, tool: AcpPermissionToolLike): void {
  const kind = classifyAcpToolKind(tool)
  if (kind === 'mutation') {
    grants.allowWrite = true
    return
  }
  if (kind === 'execute') {
    grants.allowExecute = true
    return
  }
  const key = getAcpToolGrantKey(tool)
  if (key) grants.allowedToolKeys.add(key)
}

export function evaluateAcpClientWrite({
  mode,
  targetPath,
  cwd,
  hasExactApprovedWrite,
  grants
}: {
  mode?: AgentPermissionMode
  targetPath: string
  cwd: string
  hasExactApprovedWrite: boolean
  grants: AcpSessionPermissionGrants
}): 'allow' | 'ask' {
  if (hasExactApprovedWrite || mode === 'bypassPermissions') return 'allow'
  if (mode === 'plan') return 'ask'
  if ((mode === 'acceptEdits' || grants.allowWrite) && isPathWithinWorkspace(targetPath, cwd)) return 'allow'
  return 'ask'
}

export function evaluateAcpClientTerminal({
  mode,
  grants
}: {
  mode?: AgentPermissionMode
  grants: AcpSessionPermissionGrants
}): 'allow' | 'ask' {
  if (mode === 'bypassPermissions' || (mode !== 'plan' && grants.allowExecute)) return 'allow'
  return 'ask'
}

const INJECTED_ACP_AUTOMATION_TOOL_PATTERN =
  /^(?:mcp__automation__(?:js|reset)|mcp_automation\.(?:js|reset)|automation(?:__|\s*:\s*|\/|-|_)(?:js|reset))$/i

export function isInjectedAcpAutomationTool(tool: AcpPermissionToolLike, presetId: string | undefined): boolean {
  if (classifyAcpToolKind(tool) !== 'other') return false
  const name = (tool.name ?? tool.title ?? '').trim()
  if (INJECTED_ACP_AUTOMATION_TOOL_PATTERN.test(name)) return true
  const native = acpPreset(presetId)?.automationName?.(name, tool.rawInput)
  return !!native && INJECTED_ACP_AUTOMATION_TOOL_PATTERN.test(native)
}
