import { app } from 'electron'

import { getDataPath } from './utils'

const isDev = process.env.NODE_ENV === 'development'

if (isDev) {
  app.setPath('userData', app.getPath('userData') + 'Dev')
}

export const DATA_PATH = getDataPath()

export const titleBarOverlayDark = {
  height: 40,
  color: 'rgba(0,0,0,0)',
  symbolColor: '#ffffff'
}

export const titleBarOverlayLight = {
  height: 40,
  color: 'rgba(255,255,255,0)',
  symbolColor: '#000000'
}
