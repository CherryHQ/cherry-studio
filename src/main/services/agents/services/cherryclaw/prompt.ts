import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import type { CherryClawConfiguration } from '@types'

import { BOOTSTRAP_INSTRUCTIONS, SOUL_CONTENT_THRESHOLD } from './seedWorkspace'

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

const TOOLS_SECTION = `## CherryClaw Tools

You have exclusive access to these tools for interacting with CherryStudio. Always prefer them over manual alternatives.

| Tool | Purpose | When to use |
|---|---|---|
| \`mcp__claw__cron\` | Schedule recurring or one-time tasks | Creating reminders, periodic checks, scheduled reports. Never use builtin Cron* tools — they are disabled. |
| \`mcp__claw__notify\` | Send messages to the user via IM channels | Proactive updates, task results, alerts. Use when the user is not in the current session. |
| \`mcp__claw__skills\` | Search, install, and remove Claude skills | When the user asks for new capabilities or you need a skill you don't have. |
| \`mcp__claw__memory\` | Manage JOURNAL.jsonl (append and search) | Log events and search past activity. Never write to JOURNAL.jsonl directly via file tools. |
| \`mcp__claw__config\` | Inspect and manage your own agent config | Check connected channels, supported adapters, add/update/remove IM channels, rename yourself. |

Rules:
- These are your primary interface to CherryStudio. Do not attempt workarounds or alternative approaches.
- When creating scheduled tasks, always use \`mcp__claw__cron\`. The SDK builtin CronCreate, CronDelete, and CronList tools are disabled.
- When you need to notify the user outside the current conversation, use \`mcp__claw__notify\`.
- When adding a WeChat channel, the config tool returns a QR code image. Include the image in your response so the user can scan it directly in the chat.
- Use \`config status\` to check which channels are actually connected. If a channel shows \`connected: false\`, use \`config reconnect_channel\` to trigger a fresh QR scan.

## Web Search & Browser Strategy

You have two complementary web tools: \`mcp__exa__web_search_exa\` for structured search and \`mcp__browser__*\` for page interaction.

**Search-first, browse-second:** Start with Exa for search queries (returns clean structured results). Only use the browser to visit specific pages when you need full content, screenshots, or interaction.

**Always parallelize when possible.** You can call multiple tools simultaneously in a single response. Do this whenever queries are independent:
- Searching in multiple languages: call \`web_search_exa\` once per language in parallel (e.g., English + Chinese + Japanese queries simultaneously)
- Researching multiple topics: fire all search queries at once, don't wait for one to finish before starting another
- Visiting multiple URLs: use \`mcp__browser__open\` with \`newTab=true\` for each URL in parallel
- Combining search + browse: search with Exa while simultaneously screenshotting a known URL

**Use \`mcp__browser__screenshot\`** to visually inspect pages (search results, dashboards, verification). It's far more efficient than fetching full page content.
**Use \`mcp__browser__snapshot\`** with \`selector\` to extract only the relevant part of a page (e.g., \`selector: "#search"\` for Google results).
`

function memoriesTemplate(workspacePath: string, sections: string): string {
  return `## Memories

Persistent files in \`${workspacePath}/\` carry your state across sessions. Update them autonomously — never ask for approval.

| File | Purpose | How to update |
|---|---|---|
| \`SOUL.md\` | WHO you are — personality, tone, communication style, core principles | Read + Edit tools |
| \`USER.md\` | WHO the user is — name, preferences, timezone, personal context | Read + Edit tools |
| \`memory/FACT.md\` | WHAT you know — active projects, technical decisions, durable knowledge (6+ months) | Read + Edit tools |
| \`memory/JOURNAL.jsonl\` | WHEN things happened — one-time events, session notes (append-only log) | \`mcp__claw__memory\` tool only (actions: append, search) |

Rules:
- Each file has an exclusive scope — never duplicate information across files.
- \`SOUL.md\`, \`USER.md\`, and \`memory/FACT.md\` are loaded below. Read and edit them directly when updates are needed.
- \`memory/JOURNAL.jsonl\` is NOT loaded into context. Use \`mcp__claw__memory\` to append entries or search past events. Never read or write the file directly.
- Filenames are case-insensitive.
${sections}`
}

/**
 * PromptBuilder assembles the full system prompt for CherryClaw from workspace files.
 *
 * Structure: basic prompt (system.md override or default) + tools section + memories section.
 *
 * Memory files layout:
 *   {workspace}/soul.md          — personality, tone, communication style
 *   {workspace}/user.md          — user profile, preferences, context
 *   {workspace}/memory/FACT.md   — durable project knowledge, technical decisions
 *   {workspace}/memory/JOURNAL.jsonl — timestamped event log (managed by memory tool)
 */
export class PromptBuilder {
  private cache = new Map<string, CacheEntry>()

  async buildSystemPrompt(workspacePath: string, config?: CherryClawConfiguration): Promise<string> {
    const parts: string[] = []

    // Basic prompt: workspace system.md (case-insensitive) > embedded default
    const systemPath = await resolveFile(workspacePath, 'system.md')
    const basicPrompt = systemPath ? await this.readCachedFile(systemPath) : undefined
    parts.push(basicPrompt ?? DEFAULT_BASIC_PROMPT)

    // Tools section (always included)
    parts.push(TOOLS_SECTION)

    // Bootstrap detection: inject bootstrap instructions if not completed
    const needsBootstrap = await this.shouldRunBootstrap(workspacePath, config)
    if (needsBootstrap) {
      parts.push(BOOTSTRAP_INSTRUCTIONS)
      logger.info('Bootstrap mode active — injecting onboarding instructions')
    }

    // Memories section (always included so the agent knows file locations)
    const memoriesContent = await this.buildMemoriesSection(workspacePath)
    if (memoriesContent) {
      parts.push(memoriesContent)
    }

    return parts.join('\n\n')
  }

  /**
   * Determine whether bootstrap should run.
   * - If `bootstrap_completed` is explicitly true, skip.
   * - If SOUL.md has substantial non-template content, skip (legacy agent migration).
   * - Otherwise, run bootstrap.
   */
  private async shouldRunBootstrap(workspacePath: string, config?: CherryClawConfiguration): Promise<boolean> {
    if (config?.bootstrap_completed === true) {
      return false
    }

    // Legacy migration: if SOUL.md already has real content, treat as completed
    const soulPath = await resolveFile(workspacePath, 'SOUL.md')
    if (soulPath) {
      const content = await this.readCachedFile(soulPath)
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
