/**
 * @deprecated Scheduled for removal in v2.0.0
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 *
 * This file is a v1 leftover. Its remaining responsibilities (legacy
 * titleBarOverlay constants and the global client-secret export) will be
 * absorbed by dedicated v2 modules. Do not extend this file. Do not treat
 * its patterns as a baseline for new design — route new boot-time logic
 * through BootConfigService, the preboot subsystem, and the lifecycle
 * phases instead.
 *
 * The dev-mode `userData + 'Dev'` suffix that used to live here has been
 * migrated to `core/preboot/userDataLocation.ts`.
 */

import { isWin } from '@main/constant'

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
