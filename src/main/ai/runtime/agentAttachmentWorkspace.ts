import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { application } from '@application'
import { assertAgentStoragePath, ensureAgentStorageDirectory } from '@main/ai/agents/agentDataDirectory'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { FileEntryIdSchema } from '@shared/data/types/file'
import type { CherryMessagePart } from '@shared/data/types/message'
import { readCherryMeta, withCherryMeta } from '@shared/data/types/uiParts'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { prepareAgentSessionWorkspaceDirectory } from './agentSessionWorkspace'

/** Keep message originals immutable while filesystem agents work on session-owned copies. */
export async function prepareAgentAttachmentWorkspace(
  session: AgentSessionEntity,
  parts: CherryMessagePart[]
): Promise<{ parts: CherryMessagePart[]; release(): Promise<void> }> {
  if (!parts.some((part) => part.type === 'file' && readCherryMeta(part)?.remoteAttachment))
    return { parts, release: async () => {} }
  await prepareAgentSessionWorkspaceDirectory(session)
  const root = session.workspace.path
  const result: CherryMessagePart[] = []
  const preparationId = randomUUID()
  const created: string[] = []
  const release = async () => {
    for (const file of created) {
      await assertAgentStoragePath(root, file)
      await rm(file, { force: true })
    }
  }
  try {
    for (const part of parts) {
      const meta = part.type === 'file' ? readCherryMeta(part) : undefined
      if (part.type !== 'file' || !meta?.remoteAttachment || !meta.fileEntryId) {
        result.push(part)
        continue
      }
      const id = FileEntryIdSchema.parse(meta.fileEntryId)
      const directory = path.join(root, '.cherry-studio', 'attachments', session.id, preparationId, id)
      await ensureAgentStorageDirectory(root, directory)
      const filename = path
        .basename(part.filename || id)
        .replace(/[\\/:*?"<>|]/g, '_')
        .split('')
        .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
        .join('')
      const target = path.join(directory, filename === '.' || filename === '..' ? id : filename)
      await assertAgentStoragePath(root, target)
      const manager = application.get('FileManager')
      await copyFile(manager.getPhysicalPath(id), target, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)
      created.push(target)
      await assertAgentStoragePath(root, target)
      const working = await manager.ensureExternalEntry({
        externalPath: AbsoluteFilePathSchema.parse(target),
        cleanupPolicy: 'delete_when_unreferenced'
      })
      result.push(
        withCherryMeta({ ...part, url: pathToFileURL(target).href }, { ...meta, workingFileEntryId: working.id })
      )
    }
    return { parts: result, release }
  } catch (error) {
    await release()
    throw error
  }
}
