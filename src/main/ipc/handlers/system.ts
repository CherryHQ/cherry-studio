import { loggerService } from '@logger'
import { isMac } from '@main/core/platform'
import { getCpuName, getDeviceType, getHostname } from '@main/utils/system'
import type { systemRequestSchemas } from '@shared/ipc/schemas/system'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { systemPreferences } from 'electron'
import fontList from 'font-list'

const logger = loggerService.withContext('IPC:System')

export const systemHandlers: IpcHandlersFor<typeof systemRequestSchemas> = {
  'system.get_device_type': async () => getDeviceType(),
  'system.get_hostname': async () => getHostname(),
  'system.get_cpu_name': async () => getCpuName(),
  'system.get_fonts': async () => {
    try {
      const fonts = await fontList.getFonts()
      return fonts.map((font: string) => font.replace(/^"(.*)"$/, '$1')).filter((font: string) => font.length > 0)
    } catch (error) {
      logger.error('Failed to get system fonts:', error as Error)
      return []
    }
  },
  'system.is_process_trusted': async () => {
    if (!isMac) return false
    return systemPreferences.isTrustedAccessibilityClient(false)
  },
  'system.request_process_trust': async () => {
    if (!isMac) return false
    return systemPreferences.isTrustedAccessibilityClient(true)
  }
}
