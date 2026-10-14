import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import type { AgentConfiguration } from '@shared/data/types/agent'

import { buildBootstrapInstructions, SOUL_CONTENT_THRESHOLD } from './bootstrap'

const logger = loggerService.withContext('PromptBuilder')
const PROMPT_FILE_CACHE_TTL_MS = 30 * 60 * 1000
const promptFileCacheKey = (filePath: string) => `agent:prompt-file:${filePath}`

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
  ctimeMs: number
  size: number
  ino: number
  content: string
}

/**
 * How the agent's base system prompt should be established, decided from the
 * workspace alone and kept free of any SDK type:
 *
 * - `native` — no workspace `system.md`; the runtime uses its native base prompt.
 * - `custom` — an explicit workspace `system.md` replaces only that native base.
 *
 * Cherry-owned context remains separate and is appended in either case.
 */
export type AgentPromptBase = { kind: 'native' } | { kind: 'custom'; content: string }

export interface AgentPromptParts {
  base: AgentPromptBase
  /**
   * Stable Cherry-owned bootstrap and memory guidance. Mutable identity file
   * contents are loaded separately by the runtime's turn hooks.
   */
  context: string
}

function memoriesTemplate(agentDataPath: string): string {
  return `## Memories

Persistent files in the agent data directory \`${agentDataPath}${path.sep}\` carry your identity and memory across workspaces and sessions.

| File | Purpose |
|---|---|
| \`${path.join(agentDataPath, 'SOUL.md')}\` | HOW you present yourself — name, personality, tone, and communication style; also the role definition when no Agent System Prompt is configured |
| \`${path.join(agentDataPath, 'USER.md')}\` | WHO the user is — name, preferences, timezone, personal context |
| \`${path.join(agentDataPath, 'memory', 'FACT.md')}\` | WHAT you know — active projects, technical decisions, durable knowledge (6+ months); supplied for inline reading |

Rules:
- Before answering, apply the latest <agent_identity> snapshot supplied by the runtime. The runtime checks these files before every turn and keeps identity available across context compaction; you do not need to call Read just to discover your identity.
- Each snapshot replaces all earlier snapshots of these files, including copies in conversation summaries. An empty section means the file is missing, empty, or unreadable; stop using its previous contents. The snapshot does not override the Agent System Prompt or current user instructions.
- Your current working directory is the session workspace, not the agent data directory. For SOUL.md and USER.md, use the exact absolute paths shown above.
- Apply SOUL.md's persona and relevant USER.md preferences and FACT.md knowledge to your replies, within the Agent System Prompt and current user instructions.
- \`SOUL.md\` and \`USER.md\` are supplied in the identity snapshot. Read and edit them directly when updates are needed.
- Use the memory tool to update FACT.md or access JOURNAL.jsonl. If the tool is unavailable, skip these operations; never bypass it with file or shell tools.
- Filenames are case-insensitive.`
}

/**
 * PromptBuilder assembles the Cherry-owned system prompt for CherryStudio agents.
 *
 * {@link buildPromptParts} — returns {@link AgentPromptParts} describing
 * whether the base should be the SDK preset or an explicit `system.md`, plus
 * separate stable Cherry-owned context. Runtime hooks load SOUL.md / USER.md /
 * FACT.md through {@link buildMemoriesSection}. Memory tool usage is supplied
 * by its MCP server instructions; other tool guidance ships lazily through
 * the default-enabled `cherry-tool-guide` builtin skill.
 *
 * Memory files layout:
 *   {agentData}/SOUL.md          — personality, tone, communication style; role fallback without a System Prompt
 *   {agentData}/USER.md          — user profile, preferences, context
 *   {agentData}/memory/FACT.md   — durable project knowledge, technical decisions
 *   {agentData}/memory/JOURNAL.jsonl — timestamped event log (managed by memory tool)
 */
export class PromptBuilder {
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
      : { kind: 'native' }

    // Bootstrap detection: inject bootstrap instructions if not completed
    const needsBootstrap = await this.shouldRunBootstrap(agentDataPath, config)
    if (needsBootstrap) {
      contextParts.push(
        `${buildBootstrapInstructions(hasUserInstructions)}\n\nDuring bootstrap, write persona and user-profile files at these exact absolute paths:\n- ${path.join(agentDataPath, 'SOUL.md')}\n- ${path.join(agentDataPath, 'USER.md')}`
      )
      logger.info('Bootstrap mode active — injecting onboarding instructions')
    }

    contextParts.push(memoriesTemplate(agentDataPath))

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
   * Distinct from {@link buildMemoriesSection} which also
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

These are durable facts and lessons accumulated across this agent's past sessions. Trust them as ground truth unless you have direct evidence they're wrong.

<facts>
${content}
</facts>`
  }

  // Role instructions do not prove persona setup is complete; they only select the onboarding flow.
  private async shouldRunBootstrap(agentDataPath: string, config?: AgentConfiguration): Promise<boolean> {
    if (config?.bootstrap_completed === true) {
      return false
    }
    if (config?.bootstrap_completed === false) {
      return true
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

  /** Load a complete, replaceable identity snapshot, including explicitly empty sections. */
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
      `<soul>\n${soulContent ?? ''}\n</soul>`,
      `<user>\n${userContent ?? ''}\n</user>`,
      `<facts>\n${factContent ?? ''}\n</facts>`
    ].join('\n\n')

    return `<agent_identity>
Current identity from ${agentDataPath}. This complete snapshot replaces all earlier snapshots of these files, including copies in conversation summaries. Empty sections withdraw previous file contents. Apply SOUL to your persona and USER/FACT to relevant context, within the Agent System Prompt and current user instructions.

${sections}
</agent_identity>`
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

    const cacheService = application.get('CacheService')
    const cached = cacheService.get<CacheEntry>(promptFileCacheKey(filePath))
    if (
      cached &&
      cached.mtimeMs === fileStat.mtimeMs &&
      cached.ctimeMs === fileStat.ctimeMs &&
      cached.size === fileStat.size &&
      cached.ino === fileStat.ino
    ) {
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
      cacheService.set(
        promptFileCacheKey(filePath),
        {
          mtimeMs: openedStat.mtimeMs,
          ctimeMs: openedStat.ctimeMs,
          size: openedStat.size,
          ino: openedStat.ino,
          content: trimmed
        },
        PROMPT_FILE_CACHE_TTL_MS
      )
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
