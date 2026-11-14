import { mkdir, stat } from 'node:fs/promises'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { mcpServerService } from '@data/services/McpServerService'
import { agentDataDirectoryPath } from '@main/ai/agents/agentDataDirectory'
import { resolveAutomationAccess } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { buildMcpInstructionsContext } from '@main/ai/mcp/serverInstructions'
import { isAutomationSkillAvailable } from '@main/ai/skills/automationSkills'
import { skillService } from '@main/ai/skills/SkillService'
import { getEffectiveAgentLanguage } from '@main/ai/utils/agentLanguage'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import { normalizePiDisabledToolId } from '@shared/ai/piBuiltinTools'
import type { AgentSystemPromptDraft, AgentSystemPromptPreview } from '@shared/ipc/schemas/agent'

import { loadPiSdk } from '../pi/piSdk'
import { buildDurablePrompt, renderDurablePrompt } from './durablePrompt'

const INSTRUCTIONS_SLOT = '\u0000agent-instructions\u0000'
/** A new Agent has no ID yet; its data directory is shown with this placeholder. */
const NEW_AGENT_ID = '{agent-id}'

/** An existing Agent previews in its latest session's workspace; a new one in the system workspace root. */
async function resolvePreviewWorkspace(agentId: string | undefined): Promise<string> {
  const latest = agentId ? agentSessionService.getLatestActive({ agentId })?.workspace.path : undefined
  if (latest && (await stat(latest).catch(() => undefined))?.isDirectory()) return latest
  const root = application.getPath('feature.agents.system_workspaces')
  await mkdir(root, { recursive: true })
  return root
}

/** Assemble the Pi Durable system prompt for a draft, split where the Agent's own instructions go. */
export async function previewDurableSystemPrompt(draft: AgentSystemPromptDraft): Promise<AgentSystemPromptPreview> {
  const stored = draft.agentId ? agentService.getAgent(draft.agentId) : null
  if (draft.agentId && !stored) throw new Error(`Agent not found: ${draft.agentId}`)

  const agent = {
    type: 'pi-durable' as const,
    instructions: draft.instructions,
    modelName: stored?.modelName ?? null,
    configuration: { ...stored?.configuration, language: draft.language }
  }
  const cwd = await resolvePreviewWorkspace(stored?.id)
  const preferences = application.get('PreferenceService')
  const access = resolveAutomationAccess(
    { configuration: agent.configuration, disabledTools: draft.disabledTools },
    {
      channelLinked: false,
      browserEnabled: preferences.get('app.browser.agent_control.enabled'),
      computerUseEnabled: preferences.get('app.computer_use.agent_control.enabled')
    }
  )
  const selectedSkillIds = new Set(draft.skillIds)
  const [skills, workspaceSkillPaths, pi] = await Promise.all([
    skillService.list(),
    skillService.listLocalSkillPaths(cwd),
    loadPiSdk()
  ])
  // A new Agent starts with every builtin skill enabled; the create form lists only the user's picks.
  const enabledSkills = skills.filter(
    (skill) =>
      skill.isGlobalEnabled &&
      (selectedSkillIds.has(skill.id) || (!stored && skill.source === 'builtin')) &&
      isAutomationSkillAvailable(skill, access)
  )
  const mcpServerIds = draft.mcpServerIds.flatMap((idOrName) => mcpServerService.findByIdOrName(idOrName)?.id ?? [])

  const text = await renderDurablePrompt(
    await buildDurablePrompt(pi, {
      agent,
      cwd,
      agentDataPath: agentDataDirectoryPath(application.getPath('feature.agents.data'), stored?.id ?? NEW_AGENT_ID),
      effectiveLanguage: getEffectiveAgentLanguage(agent),
      disabledTools: new Set(draft.disabledTools.map(normalizePiDisabledToolId)),
      knowledgeBaseScope: resolveKnowledgeBaseScope(draft.knowledgeBaseIds, undefined),
      skillPaths: [
        ...enabledSkills.map((skill) => skillService.getSkillDirectory(skill.folderName)),
        ...workspaceSkillPaths
      ],
      mcpInstructions: buildMcpInstructionsContext(mcpServerIds),
      instructionsSlot: INSTRUCTIONS_SLOT
    })
  )
  const [before, after] = text.split(INSTRUCTIONS_SLOT)
  if (after === undefined) throw new Error('Agent instructions slot missing from the assembled prompt')
  // Without instructions the slot stands alone between two parts, so it carries one extra separator.
  return { before, after: draft.instructions.trim() ? after : after.replace(/^\n\n/, '') }
}
