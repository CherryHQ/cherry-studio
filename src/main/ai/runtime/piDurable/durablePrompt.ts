import type { PromptSection } from '@earendil-works/pi-durable'

import { application } from '@application'
import { resolveAgentCapabilities } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { PromptBuilder } from '@main/ai/agents/prompt'
import {
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME
} from '@shared/ai/builtinTools'
import type { AgentEntity } from '@shared/data/api/schemas/agents'

import { buildAgentRuntimePrompt } from '../agentPrompt'
import { buildCitationsGuidance } from '../citationsGuidance'
import { buildPiMcpToolName } from '../pi/piMcpExtension'
import type { loadPiSdk } from '../pi/piSdk'

type PiSdk = Awaited<ReturnType<typeof loadPiSdk>>

/** A Cherry-owned section; it needs no harness input, so a preview can render it directly. */
export type DurablePromptSection = Pick<PromptSection, 'key'> & {
  render(): ReturnType<PromptSection['render']>
}

export interface DurablePromptOptions {
  agent: Pick<AgentEntity, 'instructions' | 'configuration' | 'modelName' | 'type'>
  cwd: string
  agentDataPath: string
  effectiveLanguage: string | null
  /** Normalized disabled tool IDs. */
  disabledTools: ReadonlySet<string>
  knowledgeBaseScope: readonly string[]
  skillPaths: readonly string[]
  mcpInstructions?: string
  /** Preview only; see `BuildAgentRuntimePromptOptions.instructionsSlot`. */
  instructionsSlot?: string
}

export interface DurablePrompt {
  sections: DurablePromptSection[]
  /** The agent's `instructions`, which the harness renders after every extension section. */
  instructions: string
}

/** Cherry's part of a Pi Durable system prompt, shared by the runtime and the prompt preview. */
export async function buildDurablePrompt(pi: PiSdk, options: DurablePromptOptions): Promise<DurablePrompt> {
  const { agent, cwd, agentDataPath } = options
  const enabled = (name: string) => !options.disabledTools.has(buildPiMcpToolName('cherry-tools', name))
  const prompt = await buildAgentRuntimePrompt({
    agent,
    workspacePath: cwd,
    agentDataPath,
    effectiveLanguage: options.effectiveLanguage,
    instructionsSlot: options.instructionsSlot,
    citationsGuidance: buildCitationsGuidance({
      web: enabled(WEB_SEARCH_TOOL_NAME) || enabled(WEB_FETCH_TOOL_NAME),
      kb:
        (resolveAgentCapabilities(agent).allKnowledgeBases || options.knowledgeBaseScope.length > 0) &&
        (enabled(KB_SEARCH_TOOL_NAME) || enabled(KB_READ_TOOL_NAME))
    })
  })
  const agentDir = application.getPath('feature.agents.pi.root')
  const skills = pi.loadSkills({ cwd, agentDir, skillPaths: [...options.skillPaths], includeDefaults: false })
  const builder = new PromptBuilder()
  const sections: DurablePromptSection[] = [
    {
      key: 'agent_identity',
      async render() {
        const { text, resources } = await builder.buildMemoriesContext(agentDataPath)
        return { text, source: { kind: 'memory-files', resources } }
      }
    },
    {
      key: 'project_context',
      render() {
        const files = pi.loadProjectContextFiles({ cwd, agentDir })
        if (!files.length) return undefined
        const entries = files.map((file) => ({
          ...file,
          text: `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>`
        }))
        return {
          text: ['Project-specific instructions and guidelines:', ...entries.map((entry) => entry.text)].join('\n\n'),
          source: {
            kind: 'memory-files',
            resources: entries.map((entry) => ({
              id: entry.path,
              name: entry.path,
              source: entry.path,
              characters: entry.text.length
            }))
          }
        }
      }
    },
    {
      key: 'skills',
      render: () => ({
        text: pi.formatSkillsForPrompt(skills.skills),
        source: { kind: 'skills', resources: pi.skillPromptResources(skills.skills) }
      })
    },
    {
      key: 'mcp_instructions',
      render: () =>
        options.mcpInstructions ? { text: options.mcpInstructions, source: { kind: 'mcp-instructions' } } : undefined
    }
  ]
  return {
    sections,
    instructions: [prompt.base.kind === 'custom' ? prompt.base.content : undefined, prompt.append]
      .filter(Boolean)
      .join('\n\n')
  }
}

/**
 * The system prompt text these parts produce, rendered the way pi-durable renders sections (`<key>` tags, the
 * instructions last) and pi-ai joins them. Other extensions' sections, such as codemode's tool catalog, are not included.
 */
export async function renderDurablePrompt({ sections, instructions }: DurablePrompt): Promise<string> {
  const parts: string[] = []
  for (const section of [...sections, { key: 'instructions', render: () => instructions }]) {
    const content = await section.render()
    const text = typeof content === 'object' ? content.text : content
    if (text !== undefined) parts.push(`<${section.key}>\n${text}\n</${section.key}>`)
  }
  return parts.join('\n\n')
}
