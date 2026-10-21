import { shell } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { buildAgentSessionTopicId } from '@main/ai/agentSession/topic'
import { skillCaptureService } from '@main/ai/skills/SkillCaptureService'
import { SkillRemoteUpdateError, skillService } from '@main/ai/skills/SkillService'
import { WebContentsListener } from '@main/ai/streamManager'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { skillRequestSchemas } from '@shared/ipc/schemas/skill'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import type { SkillResult } from '@shared/types/skill'

const logger = loggerService.withContext('skillHandlers')

/**
 * Skill handlers delegating to the `skillService` direct-import singleton. Legacy routes keep
 * their `SkillResult` envelope until their callers migrate; new routes return data directly so
 * IpcApi owns error serialization.
 */
async function toSkillResult<T>(op: () => Promise<T>, failMessage: string): Promise<SkillResult<T>> {
  try {
    return { success: true, data: await op() }
  } catch (error) {
    logger.error(failMessage, error as Error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const skillHandlers: IpcHandlersFor<typeof skillRequestSchemas> = {
  'skill.capture.start': ({ sessionId, messageId, requestText }, { senderId }) => {
    const wc = senderId && application.get('WindowManager').getWindow(senderId)?.webContents
    if (!wc) throw new Error('Skill creation requires a managed window')
    return skillCaptureService.start(
      { sessionId, messageId },
      new WebContentsListener(wc, buildAgentSessionTopicId(sessionId)),
      requestText
    )
  },
  'skill.capture.review': (ref) => skillCaptureService.review(ref),
  'skill.capture.save': async ({ sessionId, messageId, revision }, { senderId }) => {
    if (!senderId) throw new Error('Saving a skill requires a managed window')
    return { skillId: await skillCaptureService.save({ sessionId, messageId }, revision) }
  },
  'skill.capture.discard': (ref) => skillCaptureService.discard(ref),
  'skill.install': ({ installSource }) =>
    toSkillResult(() => skillService.install({ installSource }), 'Failed to install skill'),
  'skill.uninstall': ({ skillId }) => toSkillResult(() => skillService.uninstall(skillId), 'Failed to uninstall skill'),
  'skill.install_from_zip': ({ zipFilePath }) =>
    toSkillResult(() => skillService.installFromZip({ zipFilePath }), 'Failed to install skill from ZIP'),
  'skill.install_from_directory': ({ directoryPath }) =>
    toSkillResult(() => skillService.installFromDirectory({ directoryPath }), 'Failed to install skill from directory'),
  'skill.list_catalog': (query) => skillService.listCatalog(query),
  'skill.list_local': ({ workdir }) =>
    toSkillResult(() => skillService.listLocal(workdir), 'Failed to list local plugins'),
  'skill.reconcile': ({ skillId }) => (skillId ? skillService.reconcileSkill(skillId) : skillService.reconcileSkills()),
  'skill.remote.check': ({ skillId }) => skillService.checkRemoteUpdate(skillId),
  'skill.remote.apply': async (options) => {
    try {
      return await skillService.applyRemoteUpdate(options)
    } catch (error) {
      if (error instanceof SkillRemoteUpdateError) throw new IpcError(error.code, error.message)
      throw error
    }
  },
  'skill.discover_system': () => skillService.discoverSystem(),
  'skill.import_system': ({ directoryPath }) => skillService.importSystem({ directoryPath }),
  'skill.folder.open': async ({ skillId }, { senderId }) => {
    if (!senderId) throw new Error('Skill folders can only be opened from a managed window')

    const skill = await skillService.getById(skillId)
    if (!skill) throw new Error(`Skill not found: ${skillId}`)

    const errorMessage = await shell.openPath(skillService.getInstalledSkillDirectory(skill))
    if (errorMessage) throw new Error(`Failed to open skill folder: ${errorMessage}`)
  },
  'skill.folder.resolve': async ({ skillId }) => {
    const skill = await skillService.getById(skillId)
    if (!skill) throw new Error(`Skill not found: ${skillId}`)

    const rootPath = AbsoluteFilePathSchema.parse(skillService.getInstalledSkillDirectory(skill))
    return skill.source === 'builtin'
      ? { rootPath, access: 'read_only', readOnlyReason: 'builtin' }
      : { rootPath, access: 'read_write' }
  }
}
