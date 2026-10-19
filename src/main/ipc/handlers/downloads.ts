import { dialog } from 'electron'

import { application } from '@application'
import type { DownloadTaskRecord } from '@main/services/download/downloadStore'
import type { downloadsRequestSchemas } from '@shared/ipc/schemas/downloads'
import type { IpcHandlersFor } from '@shared/ipc/types'

function toSummary(task: DownloadTaskRecord) {
  return {
    id: task.id,
    url: task.url,
    fileName: task.fileName,
    filePath: task.filePath,
    mime: task.mime ?? null,
    state: task.state,
    totalBytes: task.totalBytes,
    receivedBytes: task.receivedBytes,
    error: task.error ?? null,
    createdAt: task.createdAt
  }
}

export const downloadsHandlers: IpcHandlersFor<typeof downloadsRequestSchemas> = {
  'downloads.list': async () => application.get('DownloadManagerService').list().map(toSummary),
  'downloads.start': async ({ url }) =>
    toSummary(await application.get('DownloadManagerService').start({ url, source: 'manual' })),
  'downloads.pause': async ({ id }) => application.get('DownloadManagerService').pause(id),
  'downloads.resume': async ({ id }) => application.get('DownloadManagerService').resume(id),
  'downloads.cancel': async ({ id }) => application.get('DownloadManagerService').cancel(id),
  'downloads.retry': async ({ id }) => application.get('DownloadManagerService').retry(id),
  'downloads.remove': async ({ id }) => application.get('DownloadManagerService').remove(id),
  'downloads.open_file': async ({ id }) => application.get('DownloadManagerService').openFile(id),
  'downloads.open_folder': async ({ id }) => application.get('DownloadManagerService').openFolder(id),
  'downloads.pick_directory': async () => {
    const picked = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return picked.canceled ? null : (picked.filePaths[0] ?? null)
  }
}
