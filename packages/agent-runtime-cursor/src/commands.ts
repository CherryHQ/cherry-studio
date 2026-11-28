import path from 'node:path'

import { skillCommand, type RuntimeCommandCatalog, type RuntimeSkillCommand } from '@cherrystudio/agent-runtime'

interface CursorSkillSources {
  workspace: string
  home: string
  readSkills(root: string): Promise<readonly { name: string; description: string; filePath: string }[]>
}

export const cursorCommandCatalog = {
  async listOffline({ workspace, home, readSkills }) {
    const directories = [workspace, home].flatMap((root) => [
      path.join(root, '.cursor', 'skills'),
      path.join(root, '.agents', 'skills')
    ])
    const sources = await Promise.all(directories.map((root) => readSkills(root)))
    const commands = new Map<string, RuntimeSkillCommand>()
    for (const skill of sources.flat()) {
      const command = skillCommand(skill)
      if (command && !commands.has(command.name)) commands.set(command.name, command)
    }
    return [...commands.values()]
  }
} satisfies RuntimeCommandCatalog<CursorSkillSources>
