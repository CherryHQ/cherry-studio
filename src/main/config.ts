/**
 * @deprecated Scheduled for removal in v2.0.0
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 *
 * This file is a v1 leftover. Its responsibilities (the dev-mode `userData + 'Dev'`
 * suffix and legacy DATA_PATH / titleBarOverlay / global secret exports) will be
 * absorbed by BootConfigService and the lifecycle system in v2. Do not extend
 * this file. Do not treat its patterns as a baseline for new design — route new
 * boot-time logic through BootConfigService and the lifecycle phases instead.
 */

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

global.CHERRYAI_CLIENT_SECRET = import.meta.env.MAIN_VITE_CHERRYAI_CLIENT_SECRET
