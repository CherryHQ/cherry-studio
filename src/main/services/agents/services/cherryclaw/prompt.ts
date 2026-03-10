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

const DEFAULT_BASIC_PROMPT = `You are CherryClaw, a personal assistant running inside CherryStudio.

`

function memoriesTemplate(workspacePath: string, sections: string): string {
  return `## Memories

Persistent files in \`${workspacePath}/\` carry your state across sessions. Update them autonomously — never ask for approval.

| File | Purpose | How to update |
|---|---|---|
| \`SOUL.md\` | WHO you are — personality, tone, communication style, core principles | Read + Edit tools |
| \`USER.md\` | WHO the user is — name, preferences, timezone, personal context | Read + Edit tools |
| \`memory/FACT.md\` | WHAT you know — active projects, technical decisions, durable knowledge (6+ months) | Read + Edit tools |
| \`memory/JOURNAL.jsonl\` | WHEN things happened — one-time events, session notes (append-only log) | \`memory\` tool only (actions: append, search) |

Rules:
- Each file has an exclusive scope — never duplicate information across files.
- \`SOUL.md\`, \`USER.md\`, and \`memory/FACT.md\` are loaded below. Read and edit them directly when updates are needed.
- \`memory/JOURNAL.jsonl\` is NOT loaded into context. Use the \`memory\` tool to append entries or search past events.
- Filenames are case-insensitive.
${sections}`
}

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
    const memoriesContent = await this.buildMemoriesSection(workspacePath)
    if (memoriesContent) {
      parts.push(memoriesContent)
    }

    return parts.join('\n\n')
  }

  private async buildMemoriesSection(workspacePath: string): Promise<string | undefined> {
    const memoryDir = path.join(workspacePath, 'memory')

    const [soulPath, userPath, factPath] = await Promise.all([
      resolveFile(workspacePath, 'SOUL.md'),
      resolveFile(workspacePath, 'USER.md'),
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

    const sections = [
      soulContent ? `<soul>\n${soulContent}\n</soul>` : '',
      userContent ? `<user>\n${userContent}\n</user>` : '',
      factContent ? `<facts>\n${factContent}\n</facts>` : ''
    ]
      .filter(Boolean)
      .join('\n\n')

    return memoriesTemplate(workspacePath, sections)
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
