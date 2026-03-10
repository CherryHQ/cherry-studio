import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'

const logger = loggerService.withContext('PromptBuilder')

/**
 * Resolve a filename within a directory using case-insensitive matching.
 * Returns the full path if found (preferring exact match), or undefined.
 */
async function resolveFile(dir: string, name: string): Promise<string | undefined> {
  const exact = path.join(dir, name)
  try {
    await stat(exact)
    return exact
  } catch {
    // exact match not found, try case-insensitive
  }

  try {
    const entries = await readdir(dir)
    const target = name.toLowerCase()
    const match = entries.find((e) => e.toLowerCase() === target)
    return match ? path.join(dir, match) : undefined
  } catch {
    return undefined
  }
}

type CacheEntry = {
  mtimeMs: number
  content: string
}

const DEFAULT_BASIC_PROMPT = `You are CherryClaw, an autonomous AI assistant.

## Guidelines

- Be concise and direct.
- Show file paths clearly.
- State intent before tool calls, but NEVER predict results before receiving them.
- Before modifying a file, read it first. Do not assume files or directories exist.
- If a tool call fails, analyze the error before retrying with a different approach.
- Ask for clarification when the request is ambiguous.

## Tools

### Always available

- \`Read\`: Read file contents (never use cat/head/tail via bash)
- \`Write\`: Create a new file or fully overwrite an existing one
- \`Edit\`: Surgical string replacement in a file (old text must match exactly)
- \`Bash\`: Run shell commands. Do NOT use bash to read/write files; use the dedicated tools above
- \`memory\`: Manage persistent knowledge across sessions. See the Memories section below for scope rules

### Conditionally available

These tools may or may not be present depending on configuration:

- \`cron\`: Create, list, and remove scheduled or one-time jobs
- \`notify\`: Send a message to the user via connected channels (e.g. Telegram)
- \`skills\`: Search, install, remove, and list agent skills from the marketplace`

/**
 * PromptBuilder assembles the full system prompt for CherryClaw from workspace files.
 *
 * Structure: basic prompt (system.md override or default) + memories section.
 *
 * Memory files layout:
 *   {workspace}/soul.md          — personality, tone, communication style
 *   {workspace}/user.md          — user profile, preferences, context
 *   {workspace}/memory/FACT.md   — durable project knowledge, technical decisions
 *   {workspace}/memory/JOURNAL.jsonl — timestamped event log (managed by memory tool)
 */
export class PromptBuilder {
  private cache = new Map<string, CacheEntry>()

  async buildSystemPrompt(workspacePath: string): Promise<string> {
    const parts: string[] = []

    // Basic prompt: workspace system.md (case-insensitive) > embedded default
    const systemPath = await resolveFile(workspacePath, 'system.md')
    const basicPrompt = systemPath ? await this.readCachedFile(systemPath) : undefined
    parts.push(basicPrompt ?? DEFAULT_BASIC_PROMPT)

    // Memories section
    const memoriesSection = await this.buildMemoriesSection(workspacePath)
    if (memoriesSection) {
      parts.push(memoriesSection)
    }

    return parts.join('\n\n')
  }

  private async buildMemoriesSection(workspacePath: string): Promise<string | undefined> {
    const memoryDir = path.join(workspacePath, 'memory')

    // Resolve all filenames case-insensitively
    const [soulPath, userPath, factPath] = await Promise.all([
      resolveFile(workspacePath, 'soul.md'),
      resolveFile(workspacePath, 'user.md'),
      resolveFile(memoryDir, 'FACT.md')
    ])

    const [soulContent, userContent, factContent] = await Promise.all([
      soulPath ? this.readCachedFile(soulPath) : Promise.resolve(undefined),
      userPath ? this.readCachedFile(userPath) : Promise.resolve(undefined),
      factPath ? this.readCachedFile(factPath) : Promise.resolve(undefined)
    ])

    if (!soulContent && !userContent && !factContent) {
      return undefined
    }

    const lines: string[] = []

    lines.push('## Memories')
    lines.push('')
    lines.push(`Persistent files that carry state across sessions. Update them autonomously — never ask for approval.`)
    lines.push('')
    lines.push('### File Layout')
    lines.push('')
    lines.push('```')
    lines.push(`${workspacePath}/`)
    lines.push('  soul.md                — WHO you are: personality, tone, communication style')
    lines.push('  user.md                — WHO the user is: name, preferences, personal context')
    lines.push('  memory/')
    lines.push('    FACT.md              — WHAT you know: durable project knowledge (6+ months)')
    lines.push('    JOURNAL.jsonl        — event log: one-time events, session notes (append-only)')
    lines.push('```')
    lines.push('')
    lines.push('### How to Update')
    lines.push('')
    lines.push('- **soul.md and user.md**: Edit directly via the `Read` and `Write` tools.')
    lines.push(
      '- **memory/FACT.md and memory/JOURNAL.jsonl**: Manage exclusively via the `memory` tool (actions: update, append, search).'
    )
    lines.push('')
    lines.push(
      'Each file has an exclusive scope — never duplicate information across files. Filenames are case-insensitive.'
    )

    if (soulContent && soulPath) {
      lines.push('')
      lines.push(`### Soul (${soulPath})`)
      lines.push('')
      lines.push('WHO you are — personality, tone, communication style, core principles.')
      lines.push('Never put here: user preferences, project facts, decisions.')
      lines.push('')
      lines.push('<soul>')
      lines.push(soulContent)
      lines.push('</soul>')
    }

    if (userContent && userPath) {
      lines.push('')
      lines.push(`### User (${userPath})`)
      lines.push('')
      lines.push('WHO the user is — name, pronouns, timezone, communication preferences, personal context.')
      lines.push('Never put here: your personality, project details, technical decisions.')
      lines.push('')
      lines.push('<user>')
      lines.push(userContent)
      lines.push('</user>')
    }

    if (factContent && factPath) {
      lines.push('')
      lines.push(`### Facts (${factPath})`)
      lines.push('')
      lines.push('WHAT you know — active projects, technical decisions, durable knowledge still relevant in 6 months.')
      lines.push('Never put here: personality/tone (soul.md), user bio (user.md), one-time events (JOURNAL).')
      lines.push('')
      lines.push('<facts>')
      lines.push(factContent)
      lines.push('</facts>')
    }

    return lines.join('\n')
  }

  /**
   * Read a file with mtime-based caching. Returns undefined if the file does not exist.
   */
  private async readCachedFile(filePath: string): Promise<string | undefined> {
    let fileStat
    try {
      fileStat = await stat(filePath)
    } catch {
      return undefined
    }

    const cached = this.cache.get(filePath)
    if (cached && cached.mtimeMs === fileStat.mtimeMs) {
      return cached.content
    }

    try {
      const content = await readFile(filePath, 'utf-8')
      const trimmed = content.trim()
      this.cache.set(filePath, { mtimeMs: fileStat.mtimeMs, content: trimmed })
      logger.debug(`Loaded ${path.basename(filePath)}`, { path: filePath, length: trimmed.length })
      return trimmed
    } catch (error) {
      logger.error(`Failed to read ${filePath}`, error as Error)
      return undefined
    }
  }
}
