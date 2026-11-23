import type { PromptSection } from '@earendil-works/pi-durable'

import { application } from '@application'
import { PromptBuilder } from '@main/ai/agents/prompt/promptContext'
import { isEditablePromptSection } from '@shared/ai/agentPromptSections'
import type { AgentEntity } from '@shared/data/api/schemas/agents'

import { buildPiAgentPrompt } from '../pi/piPrompt'
import type { loadPiSdk } from '../pi/piSdk'

type PiSdk = Awaited<ReturnType<typeof loadPiSdk>>

interface DurablePromptOptions {
  agent: Pick<AgentEntity, 'instructions' | 'configuration' | 'modelName' | 'type'>
  cwd: string
  agentDataPath: string
  effectiveLanguage: string | null
  /** Effective turn model display name for `{{model_name}}`; defaults to `agent.modelName`. */
  modelName?: string | null
  channelLinked: boolean
  /** Normalized disabled tool IDs. */
  disabledTools: ReadonlySet<string>
  knowledgeBaseScope: readonly string[]
  skillPaths: readonly string[]
  mcpInstructions?: string
  /** Preview only; see `BuildAgentPromptOptions.instructionsSlot`. */
  instructionsSlot?: string
}

/** Cherry's part of a Pi Durable system prompt, shared by the runtime and the prompt preview. */
export async function buildDurablePrompt(pi: PiSdk, options: DurablePromptOptions) {
  const { agent, cwd, agentDataPath } = options
  const overrides = agent.configuration?.prompt_overrides
  const prompt = await buildPiAgentPrompt({
    workspacePath: cwd,
    agentDataPath,
    agent,
    effectiveLanguage: options.effectiveLanguage,
    modelName: options.modelName,
    instructionsSlot: options.instructionsSlot,
    channelLinked: options.channelLinked,
    toolSearchLoadsMcp: true,
    disabledTools: options.disabledTools,
    knowledgeBaseScope: options.knowledgeBaseScope
  })
  const agentDir = application.getPath('feature.agents.pi.root')
  const skills = pi.loadSkills({ cwd, agentDir, skillPaths: [...options.skillPaths], includeDefaults: false })
  const builder = new PromptBuilder()
  const sections = [
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
    },
    { key: 'cwd', render: () => cwd.replaceAll('\\', '/') }
  ] satisfies PromptSection[]

  // An Agent's text replaces a section only when the section renders. It keeps the section's kind for Context
  // Usage but none of the files it displaced, which were not sent.
  const resolvedSections = sections.map((section) => {
    const text = isEditablePromptSection(section.key) ? overrides?.[section.key] : undefined
    if (text === undefined) return section
    return {
      key: section.key,
      async render() {
        const content = await section.render()
        if (content === undefined) return undefined
        return typeof content === 'object' ? { text, source: { kind: content.source.kind } } : text
      }
    }
  }) satisfies PromptSection[]
  return {
    sections: resolvedSections,
    instructions: [prompt.base.kind === 'custom' ? prompt.base.content : undefined, prompt.append]
      .filter(Boolean)
      .join('\n\n'),
    blocks: prompt.blocks
  }
}
