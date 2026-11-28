import path from 'node:path'

import { application } from '@application'
import { findAllSkillDirectories, findSkillMdPath, parseSkillMetadata } from '@main/utils/markdownParser'

import { SKILL_COMMAND_PREFIX } from '../skillCommands'
import type { RuntimeCatalogCommand } from '../types'

async function listCursorSkillPaths(workspace: string) {
  const roots = [workspace, application.getPath('sys.home')].flatMap((directory) => [
    path.join(directory, '.cursor', 'skills'),
    path.join(directory, '.agents', 'skills')
  ])
  const folders = await Promise.all(roots.map((root) => findAllSkillDirectories(root, root)))
  return folders.flatMap((entries) => entries.map(({ folderPath }) => folderPath))
}

export async function listCursorSkillCommands(workspace: string): Promise<RuntimeCatalogCommand[]> {
  const directories = await listCursorSkillPaths(workspace)
  const candidates = await Promise.all(
    directories.map(async (directory): Promise<RuntimeCatalogCommand | undefined> => {
      try {
        const descriptorPath = await findSkillMdPath(directory)
        if (!descriptorPath) return
        const { name, description } = await parseSkillMetadata(directory, path.basename(directory), 'skills', {
          calculateSize: false
        })
        if (!/^[\w-]+$/.test(name)) return
        return {
          name: SKILL_COMMAND_PREFIX + name,
          description: description ?? '',
          argumentHint: '',
          skillPath: descriptorPath
        }
      } catch {
        // The descriptor may have been removed or become unreadable during discovery.
        return
      }
    })
  )
  const commands = new Map<string, RuntimeCatalogCommand>()
  for (const candidate of candidates) {
    if (candidate && !commands.has(candidate.name)) commands.set(candidate.name, candidate)
  }
  return [...commands.values()]
}
