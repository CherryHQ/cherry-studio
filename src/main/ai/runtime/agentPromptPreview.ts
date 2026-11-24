import { mkdir, stat } from 'node:fs/promises'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { modelService } from '@data/services/ModelService'
import { agentDataDirectoryPath } from '@main/ai/agents/agentDataDirectory'
import { resolveAutomationAccess } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { loadBuiltinAgentDefinition } from '@main/ai/agents/builtin/BuiltinAgentProvisioner'
import { isAutomationSkillAvailable } from '@main/ai/skills/automationSkills'
import { skillService } from '@main/ai/skills/SkillService'
import { getEffectiveAgentLanguage } from '@main/ai/utils/agentLanguage'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import { replacePromptVariables } from '@main/utils/prompt'
import { AGENT_INSTRUCTIONS_SLOT } from '@shared/ai/agentPromptSections'
import { normalizePiDisabledToolId } from '@shared/ai/piBuiltinTools'
import type {
  AgentPromptBlockPreview,
  AgentPromptInstructionsDraft,
  AgentSystemPromptDraft,
  AgentSystemPromptPreview
} from '@shared/ipc/schemas/agent'

import { buildClaudeAgentPrompt } from './claudeCode'
import { buildPiAgentPrompt } from './pi/piPrompt'
import { loadPiSdk } from './pi/piSdk'
import { buildDurablePrompt } from './piDurable/durablePrompt'

/** A new Agent has no ID yet; its data directory is shown with this placeholder. */
const NEW_AGENT_ID = '{agent-id}'

function getPreviewSession(agentId: string | undefined, sessionId: string) {
  const session = agentSessionService.getById(sessionId)
  if (!agentId || session.agentId !== agentId) throw new Error('Session does not belong to the Agent')
  return session
}

/** Resolve raw draft text without assembling workspace, skill, or runtime sections. */
export function resolveAgentPromptInstructions({
  agentId,
  sessionId,
  instructions,
  modelId
}: AgentPromptInstructionsDraft) {
  let modelName: string | undefined
  if (instructions.includes('{{model_name}}')) {
    const sessionModel = sessionId ? getPreviewSession(agentId, sessionId).model : undefined
    const effectiveModel = sessionModel ?? modelId
    if (effectiveModel) {
      modelName = modelService
        .getNamesByUniqueIdsTx(application.get('DbService').getDb(), [effectiveModel])
        .get(effectiveModel)
    }
  }
  return replacePromptVariables(instructions, modelName)
}

async function resolvePreviewWorkspace(agentId: string | undefined, sessionId: string | undefined): Promise<string> {
  if (sessionId) return getPreviewSession(agentId, sessionId).workspace.path

  const latest = agentId ? agentSessionService.getLatestActive({ agentId })?.workspace.path : undefined
  if (latest && (await stat(latest).catch(() => undefined))?.isDirectory()) return latest
  const root = application.getPath('feature.agents.system_workspaces')
  await mkdir(root, { recursive: true })
  return root
}

export async function previewAgentSystemPrompt(draft: AgentSystemPromptDraft): Promise<AgentSystemPromptPreview> {
  const stored = draft.agentId ? agentService.getAgent(draft.agentId) : null
  if (draft.agentId && !stored) throw new Error(`Agent not found: ${draft.agentId}`)

  const agent = {
    type: stored?.type ?? draft.agentType ?? 'pi-durable',
    disabledTools: draft.disabledTools,
    knowledgeBaseIds: draft.knowledgeBaseIds,
    instructions: draft.instructions,
    modelName: stored?.modelName ?? null,
    configuration: {
      ...stored?.configuration,
      language: draft.language,
      claude_code_native_prompt_enabled:
        draft.claudeCodeNativePromptEnabled ?? stored?.configuration?.claude_code_native_prompt_enabled,
      prompt_overrides: undefined
    }
  }
  const cwd = await resolvePreviewWorkspace(stored?.id, draft.sessionId)
  const agentDataPath = agentDataDirectoryPath(application.getPath('feature.agents.data'), stored?.id ?? NEW_AGENT_ID)
  const builtinRole = stored?.configuration?.builtin_role
  const builtinInstructions = builtinRole ? loadBuiltinAgentDefinition(builtinRole)?.instructions : undefined
  const options = {
    agent,
    agentDataPath,
    effectiveLanguage: getEffectiveAgentLanguage(agent),
    instructionsSlot: AGENT_INSTRUCTIONS_SLOT
  }
  if (agent.type === 'claude-code') {
    const { blocks } = await buildClaudeAgentPrompt({ ...options, cwd })
    return {
      blocks: blocks.some((block) => block.key === 'cwd')
        ? blocks
        : [{ key: 'cwd', kind: 'live', text: cwd }, ...blocks],
      builtinInstructions
    }
  }

  const piOptions = {
    ...options,
    channelLinked: false,
    disabledTools: new Set(draft.disabledTools.map(normalizePiDisabledToolId)),
    knowledgeBaseScope: resolveKnowledgeBaseScope(draft.knowledgeBaseIds, undefined)
  }
  if (agent.type === 'pi') {
    const { blocks } = await buildPiAgentPrompt({ ...piOptions, workspacePath: cwd })
    return { blocks: [{ key: 'cwd', kind: 'live', text: cwd }, ...blocks], builtinInstructions }
  }

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
  const prompt = await buildDurablePrompt(pi, {
    ...piOptions,
    cwd,
    skillPaths: [
      ...enabledSkills.map((skill) => skillService.getSkillDirectory(skill.folderName)),
      ...workspaceSkillPaths
    ]
  })
  // The harness sends its sections before the instructions; they follow memory, files, skills, and MCP servers.
  const live: AgentPromptBlockPreview[] = []
  for (const section of prompt.sections) {
    const content = await section.render()
    const text = typeof content === 'object' ? content.text : content
    if (text !== undefined) live.push({ key: section.key, kind: 'live', text })
  }
  return { blocks: [...live, ...prompt.blocks], builtinInstructions }
}
