import fs from 'node:fs'

import { app } from 'electron'
import Store from 'electron-store'
import path from 'path'

const isDev = process.env.NODE_ENV === 'development'

isDev && app.setPath('userData', app.getPath('userData') + 'Dev')

const getDataPath = () => {
  const dataPath = path.join(app.getPath('userData'), 'Data')
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true })
  }
  return dataPath
}

export const DATA_PATH = getDataPath()

export const appConfig = new Store()

export const titleBarOverlayDark = {
  height: 40,
  color: '#00000000',
  symbolColor: '#ffffff'
}

export const titleBarOverlayLight = {
  height: 40,
  color: '#00000000',
  symbolColor: '#000000'
}
