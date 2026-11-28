import path from 'node:path'

import { application } from '@application'
import { findAllSkillDirectories, findSkillMdPath, parseSkillMetadata } from '@main/utils/markdownParser'

async function readSkills(root: string) {
  const directories = await findAllSkillDirectories(root, root)
  const descriptors = await Promise.all(
    directories.map(async ({ folderPath }) => {
      try {
        const filePath = await findSkillMdPath(folderPath)
        if (!filePath) return
        const { name, description } = await parseSkillMetadata(folderPath, path.basename(folderPath), 'skills', {
          calculateSize: false
        })
        return { name, description: description ?? '', filePath }
      } catch {
        // The descriptor may have been removed or become unreadable during discovery.
        return
      }
    })
  )
  return descriptors.filter((descriptor) => descriptor !== undefined)
}

export async function listCursorSkillCommands(workspace: string) {
  const { cursorCommandCatalog } = await import('@cherrystudio/agent-runtime-cursor')
  return cursorCommandCatalog.listOffline({ workspace, home: application.getPath('sys.home'), readSkills })
}
