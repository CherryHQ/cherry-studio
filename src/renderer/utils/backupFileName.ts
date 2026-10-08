import dayjs from 'dayjs'

import { ipcApi } from '@renderer/ipc'

export async function createDefaultBackupFileName(): Promise<string> {
  const [deviceType, hostname] = await Promise.all([
    ipcApi.request('system.get_device_type'),
    window.api.system.getHostname()
  ])
  const timestamp = dayjs().format('YYYYMMDDHHmmss')

  return `cherry-studio.${timestamp}.${hostname}.${deviceType}.zip`
}
