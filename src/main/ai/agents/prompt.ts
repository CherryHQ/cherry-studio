import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import type { AgentConfiguration } from '@shared/data/types/agent'

import { BOOTSTRAP_INSTRUCTIONS, SOUL_CONTENT_THRESHOLD } from './bootstrap'

const logger = loggerService.withContext('PromptBuilder')

/**
 * Resolve a filename within a directory using case-insensitive matching.
 * Returns the full path if found (preferring exact match), or undefined.
 */
async function resolveFile(dir: string, name: string, failOnError = false): Promise<string | undefined> {
  const exact = path.join(dir, name)
  try {
    const fileStat = await lstat(exact)
    if (fileStat.isFile() && !fileStat.isSymbolicLink()) return exact
    if (fileStat.isSymbolicLink()) logger.warn('Ignoring symbolic link in agent prompt data', { path: exact })
    if (failOnError) throw new Error(`Required agent prompt file is not a regular file: ${exact}`)
    return undefined
  } catch (error) {
    if (failOnError && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // exact match not found, try case-insensitive
  }

  try {
    const entries = await readdir(dir)
    const target = name.toLowerCase()
    const match = entries.find((e) => e.toLowerCase() === target)
    if (!match) return undefined
    const matchedPath = path.join(dir, match)
    const fileStat = await lstat(matchedPath)
    if (fileStat.isFile() && !fileStat.isSymbolicLink()) return matchedPath
    if (fileStat.isSymbolicLink()) logger.warn('Ignoring symbolic link in agent prompt data', { path: matchedPath })
    if (failOnError) throw new Error(`Required agent prompt file is not a regular file: ${matchedPath}`)
    return undefined
  } catch (error) {
    if (failOnError) throw error
    return undefined
  }
}

async function isRealDirectory(dir: string): Promise<boolean> {
  try {
    const directoryStat = await lstat(dir)
    if (directoryStat.isSymbolicLink()) {
      logger.warn('Ignoring symbolic-link directory in agent prompt data', { path: dir })
      return false
    }
    return directoryStat.isDirectory()
  } catch {
    return false
  }
}

type CacheEntry = {
  mtimeMs: number
  content: string
}

/**
 * How the agent's base system prompt should be established, decided from the
 * workspace alone and kept free of any SDK type:
 *
 * - `claude_code` — no workspace `system.md`; the runtime uses the SDK preset.
 * - `custom` — an explicit workspace `system.md` replaces only that base preset.
 *
 * Cherry-owned context remains separate and is appended in either case.
 */
export type AgentPromptBase = { kind: 'claude_code' } | { kind: 'custom'; content: string }

export interface AgentPromptParts {
  base: AgentPromptBase
  /**
   * Cherry-owned bootstrap/persona/memory context. The runtime appends it after
   * either base; it never contains or synthesizes the base prompt itself.
   */
  context: string
}

function memoriesTemplate(agentDataPath: string, sections: string): string {
  return `## Memories

Persistent files in the agent data directory \`${agentDataPath}/\` carry your identity and memory across workspaces and sessions. Update them autonomously — never ask for approval.

| File | Purpose | How to update |
|---|---|---|
| \`${agentDataPath}/SOUL.md\` | WHO you are — personality, tone, communication style, core principles | Read + Edit tools |
| \`${agentDataPath}/USER.md\` | WHO the user is — name, preferences, timezone, personal context | Read + Edit tools |
| \`${agentDataPath}/memory/FACT.md\` | WHAT you know — active projects, technical decisions, durable knowledge (6+ months) | Read inline + \`mcp__agent-memory__memory\` update action |
| \`${agentDataPath}/memory/JOURNAL.jsonl\` | WHEN things happened — one-time events, session notes (append-only log) | \`mcp__agent-memory__memory\` tool only (actions: append, search) |

Rules:
- Your current working directory is the session workspace, not the agent data directory. For SOUL.md and USER.md, use the exact absolute paths shown above.
- Each file has an exclusive scope — never duplicate information across files.
- \`SOUL.md\` and \`USER.md\` are loaded below. Read and edit them directly when updates are needed.
- \`memory/FACT.md\` is loaded below for inline reading. Update it only through \`mcp__agent-memory__memory\` (action: update).
- \`memory/JOURNAL.jsonl\` is NOT loaded into context. Use \`mcp__agent-memory__memory\` to append entries or search past events. Never read or write the file directly.
- Filenames are case-insensitive.
${sections}`
}

/**
 * PromptBuilder assembles the Cherry-owned system prompt for CherryStudio agents.
 *
 * {@link buildPromptParts} — returns {@link AgentPromptParts} describing
 * whether the base should be the SDK preset or an explicit `system.md`, plus
 * separate Cherry-owned context (bootstrap instructions when needed, and the
 * agent data files SOUL.md / USER.md / FACT.md). Tool-usage guidance (autonomy, memory, web) is not
 * injected here — it ships lazily via the default-enabled `cherry-tool-guide`
 * builtin skill.
 *
 * Memory files layout:
 *   {agentData}/SOUL.md          — personality, tone, communication style
 *   {agentData}/USER.md          — user profile, preferences, context
 *   {agentData}/memory/FACT.md   — durable project knowledge, technical decisions
 *   {agentData}/memory/JOURNAL.jsonl — timestamped event log (managed by memory tool)
 */
export class PromptBuilder {
  private cache = new Map<string, CacheEntry>()

  async buildPromptParts(
    workspacePath: string,
    config?: AgentConfiguration,
    hasUserInstructions = false,
    agentDataPath = workspacePath
  ): Promise<AgentPromptParts> {
    const contextParts: string[] = []

    // File presence is the explicit choice: even an empty system.md replaces only
    // the SDK base preset, while Cherry-owned context remains appended separately.
    const systemPath = await resolveFile(workspacePath, 'system.md', true)
    const base: AgentPromptBase = systemPath
      ? { kind: 'custom', content: await this.readCachedFile(systemPath, path.dirname(systemPath), true) }
      : { kind: 'claude_code' }

    // Bootstrap detection: inject bootstrap instructions if not completed
    const needsBootstrap = await this.shouldRunBootstrap(agentDataPath, config, hasUserInstructions)
    if (needsBootstrap) {
      contextParts.push(
        `${BOOTSTRAP_INSTRUCTIONS}\n\nDuring bootstrap, write identity files at these exact absolute paths:\n- ${path.join(agentDataPath, 'SOUL.md')}\n- ${path.join(agentDataPath, 'USER.md')}`
      )
      logger.info('Bootstrap mode active — injecting onboarding instructions')
    }

    // Always include the storage contract and absolute identity paths. Only the
    // loaded file-content blocks inside the section are conditional.
    contextParts.push(await this.buildMemoriesSection(agentDataPath))

    return { base, context: contextParts.join('\n\n') }
  }

  /**
   * Build a "## Agent Knowledge" section that loads just the agent's
   * `memory/FACT.md` content. This is the recall side of
   * the cross-session learning loop — agents write durable knowledge to
   * FACT.md via \`mcp__agent-memory__memory\` action="update", and this method
   * loads it back into the system prompt at the start of the next session so
   * the agent remembers what it learned (e.g. parameter shapes that previously
   * failed, project conventions, user corrections).
   *
   * Distinct from {@link buildPromptParts}'s memories section which also
   * includes the SOUL.md / USER.md persona files. Returns undefined when no
   * FACT.md exists, so callers can omit the section entirely rather than
   * emitting an empty wrapper.
   */
  async buildFactsSection(agentDataPath: string): Promise<string | undefined> {
    const memoryDir = path.join(agentDataPath, 'memory')
    if (!(await isRealDirectory(memoryDir))) return undefined
    const factPath = await resolveFile(memoryDir, 'FACT.md')
    if (!factPath) return undefined

    const content = await this.readCachedFile(factPath, agentDataPath)
    if (!content) return undefined

    return `## Agent Knowledge

These are durable facts and lessons accumulated across this agent's past sessions. Trust them as ground truth unless you have direct evidence they're wrong — in which case update \`memory/FACT.md\` via \`mcp__agent-memory__memory\` action="update" so the next session also benefits.

<facts>
${content}
</facts>`
  }

  /**
   * Determine whether bootstrap should run.
   * - If `bootstrap_completed` is explicitly true, skip.
   * - If `bootstrap_completed` is explicitly false (via `config reset_bootstrap`), run — an explicit
   *   reset overrides the instruction-based skip so the tool's "next session will onboard" holds.
   * - If the agent already has non-blank user instructions, skip.
   * - If SOUL.md has substantial non-template content, skip (legacy agent migration).
   * - Otherwise, run bootstrap.
   */
  private async shouldRunBootstrap(
    agentDataPath: string,
    config?: AgentConfiguration,
    hasUserInstructions = false
  ): Promise<boolean> {
    if (config?.bootstrap_completed === true) {
      return false
    }
    if (config?.bootstrap_completed === false) {
      return true
    }
    if (hasUserInstructions) {
      return false
    }

    // Legacy migration: if SOUL.md already has real content, treat as completed
    const soulPath = await resolveFile(agentDataPath, 'SOUL.md')
    if (soulPath) {
      const content = await this.readCachedFile(soulPath, agentDataPath)
      if (content && content.length > SOUL_CONTENT_THRESHOLD) {
        // Strip template headings to check for actual user content
        const stripped = content.replace(/^#.*$/gm, '').replace(/^>.*$/gm, '').trim()
        if (stripped.length > SOUL_CONTENT_THRESHOLD) {
          return false
        }
      }
    }

    return true
  }

  /** Build the persona and durable-memory section without the base agent prompt. */
  async buildMemoriesSection(agentDataPath: string): Promise<string> {
    const memoryDir = path.join(agentDataPath, 'memory')
    const hasRealMemoryDirectory = await isRealDirectory(memoryDir)

    const [soulPath, userPath, factPath] = await Promise.all([
      resolveFile(agentDataPath, 'SOUL.md'),
      resolveFile(agentDataPath, 'USER.md'),
      hasRealMemoryDirectory ? resolveFile(memoryDir, 'FACT.md') : Promise.resolve(undefined)
    ])

    const [soulContent, userContent, factContent] = await Promise.all([
      soulPath ? this.readCachedFile(soulPath, agentDataPath) : Promise.resolve(undefined),
      userPath ? this.readCachedFile(userPath, agentDataPath) : Promise.resolve(undefined),
      factPath ? this.readCachedFile(factPath, agentDataPath) : Promise.resolve(undefined)
    ])

    const sections = [
      soulContent ? `<soul>\n${soulContent}\n</soul>` : '',
      userContent ? `<user>\n${userContent}\n</user>` : '',
      factContent ? `<facts>\n${factContent}\n</facts>` : ''
    ]
      .filter(Boolean)
      .join('\n\n')

    return memoriesTemplate(agentDataPath, sections)
  }

  /**
   * Read a file with mtime-based caching. Returns undefined if the file does not exist.
   */
  private async readCachedFile(filePath: string, expectedRoot: string, failOnError: true): Promise<string>
  private async readCachedFile(
    filePath: string,
    expectedRoot?: string,
    failOnError?: false
  ): Promise<string | undefined>
  private async readCachedFile(
    filePath: string,
    expectedRoot = path.dirname(filePath),
    failOnError = false
  ): Promise<string | undefined> {
    const fail = (error: unknown): undefined => {
      if (failOnError) {
        throw new Error(`Failed to read required agent prompt file: ${filePath}`, { cause: error })
      }
      return undefined
    }

    let fileStat
    try {
      fileStat = await lstat(filePath)
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
        logger.warn('Ignoring non-regular file in agent prompt data', { path: filePath })
        return fail(new Error('Path is not a regular file'))
      }
    } catch (error) {
      return fail(error)
    }

    try {
      const [resolvedRoot, resolvedFile] = await Promise.all([realpath(expectedRoot), realpath(filePath)])
      const relative = path.relative(resolvedRoot, resolvedFile)
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        logger.warn('Ignoring agent prompt file outside its expected root', { path: filePath, expectedRoot })
        return fail(new Error('Path resolves outside its expected root'))
      }
    } catch (error) {
      return fail(error)
    }

    const cached = this.cache.get(filePath)
    if (cached && cached.mtimeMs === fileStat.mtimeMs) {
      return cached.content
    }

    let handle
    try {
      const flags = process.platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW
      handle = await open(filePath, flags)
      const openedStat = await handle.stat()
      if (!openedStat.isFile()) {
        logger.warn('Ignoring non-regular opened file in agent prompt data', { path: filePath })
        return undefined
      }
      const content = await handle.readFile('utf-8')
      const trimmed = content.trim()
      this.cache.set(filePath, { mtimeMs: openedStat.mtimeMs, content: trimmed })
      logger.debug(`Loaded ${path.basename(filePath)}`, { path: filePath, length: trimmed.length })
      return trimmed
    } catch (error) {
      logger.error(`Failed to read ${filePath}`, error as Error)
      return fail(error)
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }
}
