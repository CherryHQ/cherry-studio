import fs from 'node:fs'
import path from 'node:path'

import { extractLocalAcpRawInputPaths } from '@shared/ai/localAgent'
import type { LocalCanonicalPermissionMode } from '@shared/ai/localAgentPermission'

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
  const trimmedTarget = targetPath.trim()
  const trimmedCwd = cwd.trim()
  if (!trimmedTarget || !trimmedCwd) return false

  const resolvedCwd = path.resolve(trimmedCwd)
  const resolvedTarget = path.isAbsolute(trimmedTarget) ? trimmedTarget : path.resolve(resolvedCwd, trimmedTarget)
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

/** Prefer `allow_once` for host-initiated auto-approval so external CLIs do not persist session/global rules. */
export function selectAutoAllowPermissionOption<T extends { optionId: string; kind: string }>(
  options: readonly T[]
): T | undefined {
  return (
    options.find((option) => option.kind === 'allow_once') ?? options.find((option) => option.kind.startsWith('allow_'))
  )
}

export function evaluateAcpPermissionRequest({
  mode,
  tool,
  cwd,
  grants
}: {
  mode?: LocalCanonicalPermissionMode
  tool: AcpPermissionToolLike
  cwd: string
  grants: AcpSessionPermissionGrants
}): 'allow' | 'ask' {
  if (mode === 'bypassPermissions') return 'allow'
  // Native Auto uses the agent's own safety classifier and escalates only risky actions.
  if (mode === 'auto') return 'ask'

  const kind = classifyAcpToolKind(tool)
  const paths = extractAcpToolPaths(tool)

  if (mode === 'acceptEdits' && kind === 'mutation') {
    return paths.length > 0 && paths.every((targetPath) => isPathWithinWorkspace(targetPath, cwd)) ? 'allow' : 'ask'
  }

  if (kind === 'mutation' && grants.allowWrite) {
    return paths.every((targetPath) => isPathWithinWorkspace(targetPath, cwd)) ? 'allow' : 'ask'
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
  mode?: LocalCanonicalPermissionMode
  targetPath: string
  cwd: string
  hasExactApprovedWrite: boolean
  grants: AcpSessionPermissionGrants
}): 'allow' | 'ask' {
  if (hasExactApprovedWrite || mode === 'bypassPermissions') return 'allow'
  if ((mode === 'acceptEdits' || grants.allowWrite) && isPathWithinWorkspace(targetPath, cwd)) return 'allow'
  return 'ask'
}

export function evaluateAcpClientTerminal({
  mode,
  grants,
  turnApprovedExecute
}: {
  mode?: LocalCanonicalPermissionMode
  grants: AcpSessionPermissionGrants
  turnApprovedExecute: boolean
}): 'allow' | 'ask' {
  if (mode === 'bypassPermissions' || grants.allowExecute || turnApprovedExecute) return 'allow'
  return 'ask'
}
