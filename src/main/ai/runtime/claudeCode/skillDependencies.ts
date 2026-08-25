import * as fs from 'node:fs'
import * as path from 'node:path'

import { agentGlobalSkillService } from '@data/services/AgentGlobalSkillService'
import { skillService } from '@main/ai/skills/SkillService'
import { findExecutableInEnv } from '@main/utils/commandResolver'
import { findSkillMdPath, parseSkillMetadata } from '@main/utils/markdownParser'

/**
 * Runtime dependency checks for the SDK's `Skill` tool. A skill declares its fork subagent and its
 * Bash surface in frontmatter, and the SDK forks regardless of whether either resolves — a missing
 * subagent degrades into unrelated output instead of an error.
 *
 * Only a plugin-qualified subagent can be *proven* absent (its plugin and agent file are both
 * enumerable), so that is the only case that blocks. Everything else — an unresolvable bare agent
 * name, a declared executable that is not on PATH — is reported as advisory context, because
 * `allowed-tools` is a permission allowlist whose entries are frequently interchangeable
 * alternatives, and PATH lookup cannot see commands the Bash tool reaches through Git Bash.
 */

export const SKILL_TOOL_NAME = 'Skill'

const NAME_PATTERN = /^[a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)?$/
const BASH_EXECUTABLE_PATTERN = /^Bash\(\s*([a-zA-Z0-9_][a-zA-Z0-9_-]{0,127})(?=[:\s)])/u
const SDK_BUILTIN_SUBAGENTS = new Set(['claude', 'Explore', 'general-purpose', 'Plan', 'statusline-setup'])
const SHELL_BUILTINS = new Set(
  'cd command echo eval exec export false printf pwd read set source test true type unset'.split(' ')
)

export interface SkillDependencyCheck {
  /** Set only when a declared dependency is provably absent. */
  deny?: string
  /** Advisory note for the model; never blocks the call. */
  warning?: string
}

/** Index plugin directories by manifest name. Built once per session, not per tool call. */
export async function buildPluginDirectoryIndex(directories: readonly string[]): Promise<Map<string, string>> {
  const index = new Map<string, string>()
  for (const directory of directories) {
    try {
      const manifest = JSON.parse(
        await fs.promises.readFile(path.join(directory, '.claude-plugin', 'plugin.json'), 'utf-8')
      ) as { name?: unknown }
      if (typeof manifest.name === 'string' && !index.has(manifest.name)) index.set(manifest.name, directory)
    } catch {
      // The SDK owns reporting malformed plugin manifests.
    }
  }
  return index
}

const inFlightChecks = new Map<string, Promise<SkillDependencyCheck>>()

/**
 * Both PreToolUse planes ask about the same tool call — the guard rule for `deny`, the advisory hook
 * for `warning` — so share the in-flight run instead of re-parsing SKILL.md and re-probing PATH
 * twice. The entry is dropped as soon as it settles; nothing is cached across tool calls.
 */
export function checkSkillRuntimeDependencies(
  skillName: string,
  cwd: string,
  pluginDirectories: ReadonlyMap<string, string>
): Promise<SkillDependencyCheck> {
  const key = `${cwd}\0${skillName}`
  const shared = inFlightChecks.get(key)
  if (shared) return shared

  const check = runDependencyCheck(skillName, cwd, pluginDirectories).finally(() => inFlightChecks.delete(key))
  inFlightChecks.set(key, check)
  return check
}

async function runDependencyCheck(
  skillName: string,
  cwd: string,
  pluginDirectories: ReadonlyMap<string, string>
): Promise<SkillDependencyCheck> {
  const skillDirectory = await resolveSkillDirectory(skillName, cwd, pluginDirectories)
  if (!skillDirectory) return {}

  let metadata: Awaited<ReturnType<typeof parseSkillMetadata>>
  try {
    metadata = await parseSkillMetadata(skillDirectory, skillName, 'skills', { calculateSize: false })
  } catch {
    return {}
  }

  const notes: string[] = []
  const executables = await findUnresolvedExecutables(metadata.allowed_tools ?? [])
  if (executables.length > 0) {
    const list = executables.map((name) => `"${name}"`).join(', ')
    notes.push(
      `It declares the ${executables.length === 1 ? 'executable' : 'executables'} ${list}, which did not resolve on this machine; if such a command fails, report that failure instead of substituting other content.`
    )
  }

  const agentName = metadata.context === 'fork' ? metadata.agent : undefined
  const agentStatus = agentName ? await resolveAgentStatus(agentName, cwd, pluginDirectories) : 'available'
  if (agentStatus === 'absent') {
    const head = `Skill "${skillName}" cannot run: its forked subagent "${agentName}" is not installed.`
    return { deny: [head, ...notes].join(' ') }
  }
  if (agentStatus === 'unresolved') {
    notes.unshift(`Its forked subagent "${agentName}" did not resolve in this session.`)
  }

  if (notes.length === 0) return {}
  return { warning: [`Skill "${skillName}" may be missing runtime dependencies.`, ...notes].join(' ') }
}

async function resolveSkillDirectory(
  skillName: string,
  cwd: string,
  pluginDirectories: ReadonlyMap<string, string>
): Promise<string | null> {
  if (!NAME_PATTERN.test(skillName)) return null

  const separator = skillName.indexOf(':')
  if (separator >= 0) {
    const pluginDirectory = pluginDirectories.get(skillName.slice(0, separator))
    return pluginDirectory ? path.join(pluginDirectory, 'skills', skillName.slice(separator + 1)) : null
  }

  const byFolder = agentGlobalSkillService.getByFolderName(skillName)
  if (byFolder) return skillService.getInstalledSkillDirectory(byFolder)

  // The SDK addresses a skill by its SKILL.md `name` or its directory name, but the installer derives
  // folderName from the bundle directory. Only a unique name match is safe to check a call against.
  const byName = agentGlobalSkillService.listAll().filter((skill) => skill.name === skillName)
  if (byName.length === 1) return skillService.getInstalledSkillDirectory(byName[0])

  const localDirectory = path.join(cwd, '.claude', 'skills', skillName)
  return (await findSkillMdPath(localDirectory)) ? localDirectory : null
}

/**
 * `absent` is reserved for a plugin-qualified name whose plugin is indexed and has no such agent
 * file — the one case the index can settle. A bare name that misses is `unresolved` (the SDK's
 * builtin roster is a moving target), and so is an unindexed plugin: the index only holds what
 * settingsBuilder passes as `plugins`, while the enabled setting sources let the SDK load more.
 */
async function resolveAgentStatus(
  agentName: string,
  cwd: string,
  pluginDirectories: ReadonlyMap<string, string>
): Promise<'available' | 'unresolved' | 'absent'> {
  if (!NAME_PATTERN.test(agentName)) return 'available'
  if (SDK_BUILTIN_SUBAGENTS.has(agentName)) return 'available'

  const separator = agentName.indexOf(':')
  if (separator >= 0) {
    const pluginDirectory = pluginDirectories.get(agentName.slice(0, separator))
    if (!pluginDirectory) return 'unresolved'
    const definition = path.join(pluginDirectory, 'agents', `${agentName.slice(separator + 1)}.md`)
    return (await isFile(definition)) ? 'available' : 'absent'
  }

  const roots = [path.join(cwd, '.claude'), skillService.getSkillPluginDirectory(), ...pluginDirectories.values()]
  for (const root of roots) {
    if (await isFile(path.join(root, 'agents', `${agentName}.md`))) return 'available'
  }
  return 'unresolved'
}

async function findUnresolvedExecutables(allowedTools: readonly string[]): Promise<string[]> {
  const declared = Array.from(
    new Set(
      allowedTools
        .map((tool) => tool.match(BASH_EXECUTABLE_PATTERN)?.[1])
        .filter((name): name is string => typeof name === 'string' && !SHELL_BUILTINS.has(name))
    )
  )
  const resolved = await Promise.all(
    declared.map(async (name) => ((await findExecutableInEnv(name)) ? undefined : name))
  )
  return resolved.filter((name): name is string => name !== undefined)
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(filePath)).isFile()
  } catch {
    return false
  }
}
