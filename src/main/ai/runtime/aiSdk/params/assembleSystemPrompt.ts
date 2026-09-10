/**
 * TODO：distinguish static and dynamic system prompt and xml-based user prompt
 */

import type { ToolSet } from 'ai'

import { replacePromptVariables } from '@main/utils/prompt'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'

import { SKILL_FILE_PREVIEW_MAX_SIZE_BYTES, skillService } from '../../../skills/SkillService'
import { TOOL_SEARCH_TOOL_NAME } from '../../../tools/adapters/aiSdk/meta/toolSearch'
import type { ToolEntry } from '../../../tools/adapters/aiSdk/types'
import { CITATIONS_SYSTEM_PROMPT } from '../prompts/citations'
import { getDeferredToolsSystemPrompt } from '../prompts/deferredTools'

export interface AssembleSystemPromptInput {
  assistant?: Assistant
  model: Model
  /** Final tool set going to the model — checked for `tool_search` membership. */
  tools?: ToolSet
  /** Entries hidden behind `tool_search`. Used to build the namespace inventory. */
  deferredEntries?: readonly ToolEntry[]
  /** True only when a selected first-party lookup tool with the citation-id contract remains available. */
  hasCitableTools?: boolean
  /** Add a volatile local-date anchor when this request can execute web search. */
  webSearchEnabled?: boolean
  /** Skills attached to the user turn, by mirror folder name. Each SKILL.md is inlined as instructions. */
  skillFolderNames?: readonly string[]
  /** Injectable clock for deterministic tests. */
  now?: Date
}

export async function assembleSystemPrompt(input: AssembleSystemPromptInput): Promise<string | undefined> {
  const { assistant, model, tools, deferredEntries, hasCitableTools = false, webSearchEnabled = false } = input

  const sections: string[] = []

  // `anthropic-cache` checks the original assistant prompt for volatile time variables before caching.
  if (assistant?.prompt) {
    const resolved = await replacePromptVariables(assistant.prompt, model.name)
    if (resolved) sections.push(resolved)
  }

  if (input.skillFolderNames?.length) {
    sections.push(await buildSkillInstructionsSection(input.skillFolderNames))
  }

  if (tools && TOOL_SEARCH_TOOL_NAME in tools) {
    sections.push(getDeferredToolsSystemPrompt(deferredEntries))
  }

  // No persisted-output section here: that protocol is taught in-band — the
  // marker itself carries the retrieval line (getVFSOffloadReminder) and the
  // fs_read tool description carries the paging + coverage contract — so
  // conversations that never truncate pay nothing for it.

  if (hasCitableTools) {
    sections.push(CITATIONS_SYSTEM_PROMPT)
  }

  if (webSearchEnabled) {
    sections.push(buildWebSearchDateContext(input.now ?? new Date()))
  }

  if (sections.length === 0) return undefined
  return sections.join('\n\n')
}

/**
 * Inline the SKILL.md of every attached skill as a system-prompt instruction block. Chat topics
 * have no runtime that loads skills by name (unlike agent topics), so the descriptor text itself
 * must travel with the request (#19773). A missing or unreadable SKILL.md fails the turn instead
 * of silently dropping the instructions — the error reaches the UI through the stream's
 * pre-start error funnel.
 */
/** Folder names may contain characters meaningful to the pseudo-XML wrapper — escape them. */
function escapeXmlAttribute(value: string): string {
  return value.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

async function buildSkillInstructionsSection(folderNames: readonly string[]): Promise<string> {
  const blocks: string[] = []
  let totalBytes = 0
  for (const folderName of folderNames) {
    const state = await skillService.readSkillMdByFolderName(folderName)
    if (state.status !== 'found') {
      const detail =
        state.status === 'missing'
          ? 'SKILL.md not found'
          : state.reason === 'too-large'
            ? `SKILL.md exceeds the ${SKILL_FILE_PREVIEW_MAX_SIZE_BYTES / (1024 * 1024)} MB limit`
            : 'SKILL.md unreadable'
      throw new Error(`Skill "${folderName}" cannot be read (${detail}). Remove it from the message or reinstall it.`)
    }
    // Each descriptor alone fits the limit; the combined section must fit it too.
    totalBytes += Buffer.byteLength(state.content)
    if (totalBytes > SKILL_FILE_PREVIEW_MAX_SIZE_BYTES) {
      throw new Error(
        `The attached skills together exceed the ${SKILL_FILE_PREVIEW_MAX_SIZE_BYTES / (1024 * 1024)} MB limit. Remove some of them.`
      )
    }
    blocks.push(`<skill name="${escapeXmlAttribute(folderName)}">\n${state.content.trim()}\n</skill>`)
  }
  return `<attached-skills>\nThe user attached the following skills to this conversation. Follow the instructions inside each block.\n${blocks.join('\n')}\n</attached-skills>`
}

export function buildWebSearchDateContext(now: Date): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `<current-date>${year}-${month}-${day}</current-date>\nInterpret relative dates such as today, this month, and the last 30 days from this date. Do not substitute dates remembered from training or earlier conversation turns.`
}
