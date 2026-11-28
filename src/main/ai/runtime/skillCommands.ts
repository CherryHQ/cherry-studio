import path from 'node:path'

import { application } from '@application'
import { runtimeId } from '@cherrystudio/agent-runtime'
import { resolveAgentCapabilities } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { skillService } from '@main/ai/skills/SkillService'
import { findAllSkillDirectories, findSkillMdPath, parseSkillMetadata } from '@main/utils/markdownParser'
import type { AgentSessionSlashCommand } from '@shared/ai/agentSessionSlashCommands'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { resolveLinkedNotifyChannel } from './agentMcpServers'
import { listPiSessionSkillSources } from './pi/piConnectionSignature'
import { loadPiSdk } from './pi/piSdk'

type SkillCommand = AgentSessionSlashCommand & { descriptorPath: string }

export const SKILL_COMMAND_PREFIX = 'skill:'
const SKILL_INPUT_PREFIX = 'skill-command:'

export function skillCommandInputId(requestId: string) {
  return runtimeId<'input'>(SKILL_INPUT_PREFIX + requestId)
}

export function isSkillCommandInput(inputId: string | undefined): boolean {
  return inputId?.startsWith(SKILL_INPUT_PREFIX) === true
}

async function listCursorSkillPaths(workspace: string) {
  const roots = [workspace, application.getPath('sys.home')].flatMap((directory) => [
    path.join(directory, '.cursor', 'skills'),
    path.join(directory, '.agents', 'skills')
  ])
  const folders = await Promise.all(roots.map((root) => findAllSkillDirectories(root, root)))
  return folders.flatMap((entries) => entries.map(({ folderPath }) => folderPath))
}

export async function listSkillCommands(
  agent: AgentEntity,
  session: AgentSessionEntity,
  cursor: boolean
): Promise<SkillCommand[]> {
  if (!cursor && agent.type === 'pi-durable' && resolveAgentCapabilities(agent).environment === 'sealed') return []

  const cwd = session.workspace.path
  if (!cursor) {
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
        descriptorPath: filePath
      }))
  }

  const directories = await listCursorSkillPaths(cwd)
  const candidates = await Promise.all(
    directories.map(async (directory): Promise<SkillCommand | undefined> => {
      try {
        const descriptorPath = await findSkillMdPath(directory)
        if (!descriptorPath) return
        const { name, description } = await parseSkillMetadata(directory, path.basename(directory), 'skills', {
          calculateSize: false
        })
        if (!/^[\w-]+$/.test(name)) return
        return { name: SKILL_COMMAND_PREFIX + name, description: description ?? '', argumentHint: '', descriptorPath }
      } catch {
        // The descriptor may have been removed or become unreadable during discovery.
        return
      }
    })
  )
  const commands = new Map<string, SkillCommand>()
  for (const candidate of candidates) {
    if (candidate && !commands.has(candidate.name)) commands.set(candidate.name, candidate)
  }
  return [...commands.values()]
}

export function buildSkillCommandPrompt(descriptorPath: string, args: string): string {
  const instruction = `Read the Skill instructions at ${JSON.stringify(descriptorPath)} and use them for this request. Resolve any relative Skill files from the directory containing those instructions.`
  return args ? `${instruction}\n\n${args}` : instruction
}
