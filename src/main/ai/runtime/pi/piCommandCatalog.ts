import { application } from '@application'
import { resolveAgentCapabilities } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { listPiSessionSkillSources } from '@main/ai/skills/piSessionSkills'
import { skillService } from '@main/ai/skills/SkillService'

import { resolveLinkedNotifyChannel } from '../linkedNotifyChannel'
import { SKILL_COMMAND_PREFIX } from '../skillCommands'
import type { RuntimeCatalogCommand, RuntimeCommandContext } from '../types'
import { loadPiSdk } from './piSdk'

export async function listPiSkillCommands({ agent, session }: RuntimeCommandContext): Promise<RuntimeCatalogCommand[]> {
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
  const pi = await loadPiSdk()
  const { skills } = pi.loadSkills({
    cwd,
    agentDir: application.getPath('feature.agents.pi.root'),
    skillPaths,
    includeDefaults: false
  })
  return skills
    .filter(({ name }) => /^[\w-]+$/.test(name))
    .map(({ name, description, filePath }) => ({
      name: SKILL_COMMAND_PREFIX + name,
      description,
      argumentHint: '',
      skillPath: filePath
    }))
}

export function piCommandCapabilities(context: RuntimeCommandContext) {
  return {
    listOffline: () => (context.session.workspace?.path ? listPiSkillCommands(context) : Promise.resolve([]))
  }
}
