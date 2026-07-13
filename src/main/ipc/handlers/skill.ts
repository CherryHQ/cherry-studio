import { loggerService } from '@logger'
import { skillService } from '@main/ai/skills/SkillService'
import type { skillRequestSchemas } from '@shared/ipc/schemas/skill'
import type { IpcHandlersFor } from '@shared/ipc/types'
import type { SkillResult } from '@shared/types/skill'

const logger = loggerService.withContext('skillHandlers')

/**
 * Skill handlers delegating to the `skillService` direct-import singleton. Each keeps the
 * legacy `SkillResult` envelope (catch + log + `{ success: false, error }`) so the renderer's
 * `unwrapSkillResult` is unchanged. Skill_ReadFile / Skill_ListFiles stay on legacy IPC.
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
  'skill.install': ({ installSource }) =>
    toSkillResult(() => skillService.install({ installSource }), 'Failed to install skill'),
  'skill.uninstall': ({ skillId }) => toSkillResult(() => skillService.uninstall(skillId), 'Failed to uninstall skill'),
  'skill.install_from_zip': ({ zipFilePath }) =>
    toSkillResult(() => skillService.installFromZip({ zipFilePath }), 'Failed to install skill from ZIP'),
  'skill.install_from_directory': ({ directoryPath }) =>
    toSkillResult(() => skillService.installFromDirectory({ directoryPath }), 'Failed to install skill from directory'),
  'skill.list_local': ({ workdir }) =>
    toSkillResult(() => skillService.listLocal(workdir), 'Failed to list local plugins')
}
