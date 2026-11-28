import { application } from '@application'
import { resolveAutomationAccess } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { isAutomationSkillAvailable } from './automationSkills'
import { skillService } from './SkillService'

export async function listPiSessionSkillSources(
  agent: AgentEntity,
  session: AgentSessionEntity,
  channelLinked: boolean
) {
  const [skills, workspaceSkillPaths] = await Promise.all([
    skillService.list({ agentId: agent.id }),
    skillService.listLocalSkillPaths(session.workspace.path)
  ])
  const access = resolveAutomationAccess(agent, {
    channelLinked,
    browserEnabled: application.get('PreferenceService').get('app.browser.agent_control.enabled'),
    computerUseEnabled: application.get('PreferenceService').get('app.computer_use.agent_control.enabled')
  })
  const enabledSkills = skills.filter((skill) => skill.isEnabled && isAutomationSkillAvailable(skill, access))
  return { enabledSkills, workspaceSkillPaths }
}
