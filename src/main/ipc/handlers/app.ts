import { arch } from 'node:os'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import type { appRequestSchemas } from '@shared/ipc/schemas/app'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { app } from 'electron'

export const appHandlers: IpcHandlersFor<typeof appRequestSchemas> = {
  'app.get_info': async () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    appPath: application.getPath('app.root'),
    filesPath: application.getPath('feature.files.data'),
    notesPath: application.getPath('feature.notes.data'),
    configPath: application.getPath('cherry.config'),
    appDataPath: application.getPath('app.userdata'),
    resourcesPath: application.getPath('app.root.resources'),
    logsPath: loggerService.getLogsDir(),
    arch: arch(),
    isPortable: isWin && 'PORTABLE_EXECUTABLE_DIR' in process.env,
    installPath: application.getPath('app.install')
  })
}
