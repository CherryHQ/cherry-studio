/**
 * Pure, data-driven tool-call policy for the dsh runtime, ported from
 * `src/main/ai/runtime/pi/approvalExtension.ts` (containment fast-paths) and
 * `src/main/ai/runtime/toolApproval/dependencyGuard.ts` (global-install guard).
 * Dependency-free by design: it runs inside the dsh subprocess.
 */
import { lstat, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { BridgePolicy } from './protocol'

export type ToolDecision = { kind: 'allow' } | { kind: 'deny'; reason: string } | { kind: 'ask'; reason?: string }

/**
 * Decide one tool call under the host-pushed policy.
 * Pipeline: disabled → deny; plan mode → closed allow-list (dsh plan mode enforces
 * nothing itself, so this branch IS the read-only guarantee); approval-required →
 * ask, except under bypassPermissions — the user's explicit opt-out of per-call
 * approval lifts ordinary entries, while non-bypassable delegation still asks; first-party
 * auto-approved → allow; bypass → allow; contained read/edit fast-paths;
 * everything else asks.
 */
export async function decideToolCall(policy: BridgePolicy, toolName: string, args: unknown): Promise<ToolDecision> {
  if (policy.disabledTools.includes(toolName)) {
    return { kind: 'deny', reason: `Tool "${toolName}" is disabled for this agent.` }
  }
  if (policy.permissionMode === 'plan') {
    if (policy.planSafeTools.includes(toolName)) return { kind: 'allow' }
    if (policy.readTools.includes(toolName)) {
      return (await isToolPathInsideAllowedRoots(args, policy.allowedRoots, false))
        ? { kind: 'allow' }
        : {
            kind: 'deny',
            reason: `Plan mode allows reads only inside the workspace; "${toolName}" targeted a path outside it.`
          }
    }
    return {
      kind: 'deny',
      reason: `Plan mode is read-only: "${toolName}" is unavailable until the plan is approved.`
    }
  }
  if (
    policy.approvalRequiredTools.includes(toolName) &&
    (policy.permissionMode !== 'bypassPermissions' || policy.nonBypassableApprovalTools.includes(toolName))
  ) {
    return { kind: 'ask' }
  }
  if (policy.autoApprovedTools.includes(toolName)) return { kind: 'allow' }
  if (policy.permissionMode === 'bypassPermissions') return { kind: 'allow' }
  if (policy.readTools.includes(toolName)) {
    return (await isToolPathInsideAllowedRoots(args, policy.allowedRoots, false)) ? { kind: 'allow' } : { kind: 'ask' }
  }
  if (policy.permissionMode === 'acceptEdits' && policy.editTools.includes(toolName)) {
    return (await isToolPathInsideAllowedRoots(args, policy.allowedRoots, true)) ? { kind: 'allow' } : { kind: 'ask' }
  }
  return { kind: 'ask' }
}

/**
 * Decide one tool call made by a delegated subagent. Same policy as the root, but
 * `ask` degrades to an explicit deny: dsh pins delegated approval policy to
 * `never`, so an interactive ask can never reach a human and silently failing
 * there would leave the model retrying a dead end.
 */
export async function decideDelegatedToolCall(
  policy: BridgePolicy,
  toolName: string,
  args: unknown
): Promise<ToolDecision> {
  const decision = await decideToolCall(policy, toolName, args)
  if (decision.kind !== 'ask') return decision
  return {
    kind: 'deny',
    reason:
      `Tool "${toolName}" needs interactive approval, which a delegated subagent cannot request. ` +
      'Report this back so the coordinating agent (or the user) can run it instead.'
  }
}

/** Unicode spaces folded to a plain space before resolving (matches pi's `normalizePath`). */
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g

/**
 * Conservative containment check for the auto-approve fast-path. Any ambiguity
 * (non-string path, `file://` URL, resolution failure) counts as OUTSIDE so an
 * approval is required. Roots and existing targets are canonicalized (realpath)
 * before comparison so a symlink cannot make an outside target look inside; for
 * a new edit/write target the nearest existing parent is canonicalized and the
 * missing suffix appended. Relative paths resolve against `allowedRoots[0]`
 * (the session workspace, by protocol contract).
 */
export async function isToolPathInsideAllowedRoots(
  args: unknown,
  allowedRoots: string[],
  allowMissingTarget: boolean
): Promise<boolean> {
  if (allowedRoots.length === 0) return false
  const record = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}
  // dsh fs tools name the target `file_path`; search-style tools use `path`.
  const raw = record.file_path ?? record.path
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return false

  // A missing/empty path defaults to "." → the workspace root, which is inside.
  const resolved = resolveToolPath((raw as string | undefined) || '.', allowedRoots[0])
  if (resolved === undefined) return false

  const canonicalTarget = await canonicalizeToolTarget(resolved, allowMissingTarget)
  if (canonicalTarget === undefined) return false

  for (const root of allowedRoots) {
    const canonicalRoot = await canonicalizeExistingPath(root)
    if (canonicalRoot === undefined) continue
    const rel = path.relative(canonicalRoot, canonicalTarget)
    if (rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))) return true
  }
  return false
}

/** Resolve a raw tool path to an absolute one; undefined marks ambiguous inputs (e.g. `file://`). */
export function resolveToolPath(raw: string, workspacePath: string): string | undefined {
  let p = raw.replace(UNICODE_SPACES, ' ')
  if (p.startsWith('@')) p = p.slice(1)
  if (p === '~') p = os.homedir()
  else if (p.startsWith('~/') || (process.platform === 'win32' && p.startsWith('~\\'))) {
    p = path.join(os.homedir(), p.slice(2))
  } else if (p.startsWith('file://')) {
    return undefined
  }
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(workspacePath, p)
}

async function canonicalizeExistingPath(target: string): Promise<string | undefined> {
  try {
    return await realpath(target)
  } catch {
    return undefined
  }
}

async function canonicalizeToolTarget(target: string, allowMissing: boolean): Promise<string | undefined> {
  try {
    return await realpath(target)
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
    // A dangling symlink exists but cannot be canonicalized; treat it as ambiguous, not as a new file.
    try {
      await lstat(target)
      return undefined
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
    }
  }

  let parent = path.dirname(target)
  while (true) {
    try {
      const canonicalParent = await realpath(parent)
      return path.resolve(canonicalParent, path.relative(parent, target))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
      try {
        await lstat(parent)
        return undefined
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
      }
      const next = path.dirname(parent)
      if (next === parent) return undefined
      parent = next
    }
  }
}

// A `-g` / `--global` flag as a standalone token (not a substring of a package name).
const GLOBAL_FLAG = /(?:^|\s)(?:-g|--global)(?:\s|$)/

const GLOBAL_INSTALL_RULES: Array<{ test: (seg: string) => boolean; reason: string }> = [
  {
    test: (s) => /\b(?:npm|pnpm|yarn|bun)\b/.test(s) && /\b(?:install|i|add)\b/.test(s) && GLOBAL_FLAG.test(s),
    reason: 'global JS package install (-g/--global)'
  },
  {
    test: (s) => /\byarn\s+global\s+add\b/.test(s),
    reason: 'yarn global add'
  },
  {
    test: (s) => /\buv\s+tool\s+install\b/.test(s),
    reason: 'uv tool install (persistent global tool — use `uvx` for one-off runs)'
  },
  {
    test: (s) => /\bpipx\s+install\b/.test(s),
    reason: 'pipx install (global)'
  },
  {
    test: (s) => /\bpip3?\s+install\b/.test(s) && /(?:^|\s)(?:--user|--system|--break-system-packages)(?:\s|$)/.test(s),
    reason: 'global pip install (--user/--system/--break-system-packages)'
  },
  {
    test: (s) => /\buv\s+pip\s+install\b/.test(s) && /(?:^|\s)--system(?:\s|$)/.test(s),
    reason: 'uv pip install --system'
  },
  {
    // BinaryManager is the sole owner of Cherry's isolated mise state.
    test: (s) =>
      /\bmise\s+(?:(?:use|install|uninstall|remove|rm|prune|upgrade|update|reshim|trust|untrust)\b|plugins?\s+(?:install|uninstall|update)\b|settings?\s+(?:set|unset)\b)/.test(
        s
      ),
    reason: 'direct mise mutation (use cli_search / cli_install)'
  },
  {
    test: (s) => /\bcargo\s+install\b/.test(s),
    reason: 'cargo install (persistent user tool)'
  },
  {
    test: (s) => /\bgo\s+install\b/.test(s),
    reason: 'go install (persistent user tool)'
  },
  {
    test: (s) => /\bgem\s+install\b/.test(s),
    reason: 'gem install (persistent user tool)'
  },
  {
    test: (s) => /\b(?:brew|apt(?:-get)?|dnf|yum)\s+install\b/.test(s),
    reason: 'system package-manager install'
  },
  {
    test: (s) => /\bdotnet\s+tool\s+install\b/.test(s) && GLOBAL_FLAG.test(s),
    reason: 'dotnet tool install --global'
  }
]

/**
 * Returns a short human reason when `command` installs into a global/shared
 * location (leaking across agent sessions), or `null` when it is safe.
 */
export function detectGlobalInstall(command: string): string | null {
  // Test each chained segment independently so a flag in one command can't be
  // mis-attributed to a manager keyword in another (`ls && npm i -g x`).
  const segments = command.split(/&&|\|\||[;\n|]/)
  for (const rawSegment of segments) {
    const segment = rawSegment.trim()
    if (!segment) continue
    for (const rule of GLOBAL_INSTALL_RULES) {
      if (rule.test(segment)) return rule.reason
    }
  }
  return null
}
