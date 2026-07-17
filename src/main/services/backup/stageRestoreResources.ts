import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { resolveUserDataRelativePath } from '@main/data/db/restore/resolveUserDataRelativePath'
import type { RestoreJournal } from '@main/data/db/restore/restoreJournal'

import type { ArchiveContext } from './admitArchive'
import { BackupArchiveCorruptError, RestoreStagingNotImplementedError } from './errors'

const logger = loggerService.withContext('backup/stageRestoreResources')

/**
 * Build the preboot promotion entries for the restore resource kinds that are
 * currently supported. SKILLS is intentionally first: zip/local skill folders
 * are additive and do not participate in file_entry skip/prune semantics.
 *
 * Same-name live skills are never overwritten or deleted. Their local directory
 * wins and no journal entry is emitted; SkillService reconciles DB/FS on startup.
 * Other resource kinds stay fail-closed until their own consistency rules land.
 */
export function stageRestoreResources(
  resourceMetadata: ArchiveContext['resourceMetadata'],
  workDir: string
): RestoreJournal['fileResources'] {
  const { fileIds, knowledgeBases, notePaths, skillFolders } = resourceMetadata
  if (fileIds.length > 0 || knowledgeBases.length > 0 || notePaths.length > 0) {
    throw new RestoreStagingNotImplementedError()
  }

  const entries: RestoreJournal['fileResources'] = []
  for (const { folderName } of skillFolders) {
    const stagedPath = path.join(workDir, 'skills', folderName)
    if (!fs.existsSync(stagedPath) || !fs.lstatSync(stagedPath).isDirectory()) {
      throw new BackupArchiveCorruptError(`manifest skill directory is missing or invalid: ${folderName}`)
    }

    const livePath = application.getPath('feature.agents.skills', folderName)
    if (fs.existsSync(livePath)) {
      logger.warn('restore: keeping existing local skill directory', { folderName })
      continue
    }

    entries.push({
      kind: 'dir-add',
      stagingPath: toJournalPath(stagedPath),
      livePath: toJournalPath(livePath)
    })
  }
  return entries
}

function toJournalPath(targetPath: string): string {
  const relativePath = path.relative(application.getPath('app.userdata'), targetPath)
  resolveUserDataRelativePath(relativePath)
  return relativePath
}
