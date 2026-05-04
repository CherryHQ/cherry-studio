/**
 * `skills__load` builtin tool. The model has seen the skill catalog
 * in the system prompt; this tool returns the full SKILL.md body so
 * the model can follow the skill's instructions.
 *
 * Permission defaults to `'allow'` — loading a skill is a read-only
 * operation. The skill body itself may instruct the model to call
 * other tools; those tool calls go through the normal permission
 * pipeline regardless of how they were prompted.
 */

import { listCatalog } from '@main/ai/skills/catalog'
import { topicService } from '@main/data/services/TopicService'
import { type Tool, tool } from 'ai'
import * as z from 'zod'

import { BuiltinToolNamespace, ToolCapability, ToolDefer, type ToolEntry } from '../../types'

export const SKILLS_LOAD_TOOL_NAME = 'skills__load'

const inputSchema = z.object({
  name: z.string().min(1).describe('The skill name as listed in the skills catalog.')
})

type Input = z.infer<typeof inputSchema>
type Output = { kind: 'loaded'; name: string; body: string } | { kind: 'error'; code: 'unknown-skill'; message: string }

const skillsLoadTool = tool({
  description: 'Load the full instructions of a named skill from the catalog.',
  inputSchema,
  inputExamples: [{ input: { name: 'gh-create-pr' } }],
  async execute(input: Input, opts) {
    const ctx = (opts?.experimental_context ?? {}) as { topicId?: string }
    const workspaceRoot = ctx.topicId ? ((await topicService.getWorkspaceRoot(ctx.topicId)) ?? null) : null

    const skills = await listCatalog({ workspaceRoot })
    const skill = skills.find((s) => s.name === input.name)
    if (!skill) {
      return {
        kind: 'error',
        code: 'unknown-skill',
        message: `No skill named '${input.name}' is available. Use only names listed in the skills catalog.`
      } satisfies Output
    }
    return { kind: 'loaded', name: skill.name, body: skill.body } satisfies Output
  }
}) as Tool

export function createSkillsLoadToolEntry(): ToolEntry {
  return {
    name: SKILLS_LOAD_TOOL_NAME,
    namespace: BuiltinToolNamespace.Skills,
    description: 'Load a named skill from the catalog. Returns the full skill instructions for the model to follow.',
    defer: ToolDefer.Auto,
    capability: ToolCapability.Read,
    tool: skillsLoadTool,
    checkPermissions: () => ({ behavior: 'allow' })
  }
}
