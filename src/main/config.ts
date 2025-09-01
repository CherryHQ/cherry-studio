import { isDev, isWin } from '@main/constant'
import { app } from 'electron'

import { getDataPath } from './utils'

if (isDev) {
  app.setPath('userData', app.getPath('userData') + 'Dev')
}

export const DATA_PATH = getDataPath()

export const titleBarOverlayDark = {
  height: 42,
  color: isWin ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0)',
  symbolColor: '#fff'
}

export const titleBarOverlayLight = {
  height: 42,
  color: 'rgba(255,255,255,0)',
  symbolColor: '#000'
}

global.CHERRYIN_CLIENT_SECRET = import.meta.env.MAIN_VITE_CHERRYIN_CLIENT_SECRET
