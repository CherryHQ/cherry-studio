import { ipcApi } from '@renderer/ipc'

export function openExternalWebsite(url: string): Promise<void> {
  return ipcApi.request('system.shell.open_external_website', url)
}
