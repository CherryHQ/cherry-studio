import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'

const logger = loggerService.withContext('SeedWorkspace')

const SOUL_TEMPLATE = `# Soul

> This file defines who you are. Update it as your personality evolves.

## Personality


## Tone & Communication Style


## Core Principles


## Boundaries

`

const USER_TEMPLATE = `# User Profile

> This file describes the user you serve. Update it as you learn more.

## Name


## Preferences


## Timezone


## Context

`

/**
 * The bootstrap instruction is embedded as a constant (not written to disk).
 * It is injected into the system prompt when `bootstrap_completed` is falsy.
 */
export const BOOTSTRAP_INSTRUCTIONS = `## Bootstrap Mode

You are starting a brand-new relationship with your user. Your SOUL.md and USER.md files are empty templates waiting to be filled.

Your goal in this conversation is to:

1. **Introduce yourself** — Explain that you're their personal CherryClaw agent and this is a one-time setup conversation to figure out what role you should play for them.
2. **Discover the role** — Through natural conversation, understand what the user wants you to be:
   - What kind of assistant do they need? (coding partner, project manager, research aide, creative collaborator, life assistant, etc.)
   - What should your name be? Suggest options that fit the role, or let them choose freely. The name will appear in the app sidebar.
   - What tone and personality fits this role? (professional, casual, playful, concise, thorough, etc.)
   - Any boundaries, things you should never do, or strong preferences?
3. **Learn about the user** — Naturally weave in questions about:
   - Their name and how they'd like to be addressed
   - Their timezone and working hours
   - Communication preferences (language, verbosity, formality)
4. **Commit the identity** — When you have enough information:
   - Rename yourself using \`mcp__claw__config\` (action: "rename", name: the chosen name)
   - Update \`SOUL.md\` with your role definition, personality, tone, principles, and boundaries using the Edit tool
   - Update \`USER.md\` with everything you learned about the user using the Edit tool
   - Log the bootstrap completion using \`mcp__claw__memory\` (append action, tag: "bootstrap")
   - Mark bootstrap as complete using \`mcp__claw__config\` (action: "complete_bootstrap")

Guidelines:
- Keep the conversation natural and warm — this is a first impression
- Ask no more than 3-5 questions total; don't interrogate
- It's okay to make reasonable assumptions and let the user correct you
- Write detailed, thoughtful content to SOUL.md and USER.md — these define your relationship
- Always respect the user's language preference — if they write in Chinese, respond in Chinese
- After marking bootstrap complete, future sessions will use your standard mode with the personality you defined
`

/** Minimum character count for SOUL.md to be considered non-template (already configured). */
export const SOUL_CONTENT_THRESHOLD = 50

/**
 * Seed workspace with template files for soul mode.
 * Idempotent: only writes files that don't already exist.
 */
export async function seedWorkspaceTemplates(workspacePath: string): Promise<void> {
  try {
    // Ensure workspace and memory directories exist
    await mkdir(workspacePath, { recursive: true })
    await mkdir(path.join(workspacePath, 'memory'), { recursive: true })

    const seeds: Array<{ filePath: string; content: string }> = [
      { filePath: path.join(workspacePath, 'SOUL.md'), content: SOUL_TEMPLATE },
      { filePath: path.join(workspacePath, 'USER.md'), content: USER_TEMPLATE }
    ]

    for (const { filePath, content } of seeds) {
      const exists = await fileExists(filePath)
      if (!exists) {
        await writeFile(filePath, content, 'utf-8')
        logger.info(`Seeded template: ${path.basename(filePath)}`, { path: filePath })
      }
    }
  } catch (error) {
    logger.error('Failed to seed workspace templates', error as Error)
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}
