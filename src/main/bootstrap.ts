import { app } from 'electron'

import { initAppDataDir } from './utils/file'

app.isPackaged && initAppDataDir()
