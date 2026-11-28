import { type RuntimeCommandCatalog, skillCommand } from '@cherrystudio/agent-runtime'

import { piBuiltinCommands } from './commandMetadata'

interface PiSkillSources {
  cwd: string
  agentDir: string
  skillPaths: string[]
}

export const piCommandCatalog = {
  builtinCommands: piBuiltinCommands,
  async listOffline({ cwd, agentDir, skillPaths }) {
    if (skillPaths.length === 0) return []
    const { loadSkills } = await import('@earendil-works/pi-coding-agent')
    return loadSkills({ cwd, agentDir, skillPaths, includeDefaults: false }).skills.flatMap((skill) => {
      const command = skillCommand(skill)
      return command ? [command] : []
    })
  }
} satisfies RuntimeCommandCatalog<PiSkillSources>
