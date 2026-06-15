import { loggerService } from '@logger'
import { skillService } from '@main/ai/skills/SkillService'
import type { skillRequestSchemas } from '@shared/ipc/schemas/skill'
import type { IpcHandlersFor } from '@shared/ipc/types'

const logger = loggerService.withContext('SkillIpcHandler')

const success = <T>(data: T) => ({ success: true as const, data })

const failure = (error: unknown) => ({ success: false as const, error: errorMessage(error) })

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Unknown error')
}

export const skillHandlers: IpcHandlersFor<typeof skillRequestSchemas> = {
  'skill.list': async (input) => {
    try {
      const data = await skillService.list(input?.agentId ? { agentId: input.agentId } : {})
      return success(data)
    } catch (error) {
      logger.error('Failed to list skills', { error: errorMessage(error) })
      return failure(error)
    }
  },
  'skill.install': async (options) => {
    try {
      const data = await skillService.install(options)
      return success(data)
    } catch (error) {
      logger.error('Failed to install skill', { options, error: errorMessage(error) })
      return failure(error)
    }
  },
  'skill.uninstall': async ({ skillId }) => {
    try {
      await skillService.uninstall(skillId)
      return success(undefined)
    } catch (error) {
      logger.error('Failed to uninstall skill', { skillId, error: errorMessage(error) })
      return failure(error)
    }
  },
  'skill.toggle': async (options) => {
    try {
      const data = await skillService.toggle(options)
      return success(data)
    } catch (error) {
      logger.error('Failed to toggle skill', { options, error: errorMessage(error) })
      return failure(error)
    }
  },
  'skill.install_from_zip': async (options) => {
    try {
      const data = await skillService.installFromZip(options)
      return success(data)
    } catch (error) {
      logger.error('Failed to install skill from ZIP', { options, error: errorMessage(error) })
      return failure(error)
    }
  },
  'skill.install_from_directory': async (options) => {
    try {
      const data = await skillService.installFromDirectory(options)
      return success(data)
    } catch (error) {
      logger.error('Failed to install skill from directory', { options, error: errorMessage(error) })
      return failure(error)
    }
  },
  'skill.read_file': async ({ skillId, filename }) => {
    try {
      const data = await skillService.readFile(skillId, filename)
      return success(data)
    } catch (error) {
      logger.error('Failed to read skill file', { skillId, filename, error: errorMessage(error) })
      return failure(error)
    }
  },
  'skill.list_files': async ({ skillId }) => {
    try {
      const data = await skillService.listFiles(skillId)
      return success(data)
    } catch (error) {
      logger.error('Failed to list skill files', { skillId, error: errorMessage(error) })
      return failure(error)
    }
  },
  'skill.list_local': async ({ workdir }) => {
    try {
      const data = await skillService.listLocal(workdir)
      return success(data)
    } catch (error) {
      logger.error('Failed to list local plugins', { workdir, error: errorMessage(error) })
      return failure(error)
    }
  }
}
