import { application } from '@application'
import type { RuntimeSkillCommand } from '@cherrystudio/agent-runtime'
import { resolveAgentCapabilities } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { listPiSessionSkillSources } from '@main/ai/skills/piSessionSkills'
import { skillService } from '@main/ai/skills/SkillService'

import { resolveLinkedNotifyChannel } from '../linkedNotifyChannel'
import type { RuntimeCommandContext } from '../types'

export async function listPiSkillCommands({ agent, session }: RuntimeCommandContext): Promise<RuntimeSkillCommand[]> {
  if (agent.type === 'pi-durable' && resolveAgentCapabilities(agent).environment === 'sealed') return []

  const cwd = session.workspace.path
  const { enabledSkills, workspaceSkillPaths } = await listPiSessionSkillSources(
    agent,
    session,
    resolveLinkedNotifyChannel(session.id, agent.id) !== null
  )
  const skillPaths = [
    ...enabledSkills.map((skill) => skillService.getInstalledSkillDirectory(skill)),
    ...workspaceSkillPaths
  ]
  if (skillPaths.length === 0) return []
  const { piCommandCatalog } = await import('@cherrystudio/agent-runtime-pi')
  return piCommandCatalog.listOffline({ cwd, agentDir: application.getPath('feature.agents.pi.root'), skillPaths })
}

export function piCommandCapabilities(context: RuntimeCommandContext) {
  return {
    listOffline: () => (context.session.workspace?.path ? listPiSkillCommands(context) : Promise.resolve([]))
  }
}
