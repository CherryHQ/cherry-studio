import { readFileSync } from 'node:fs'

import { app } from 'electron'

import { application } from '@application'
import { isMac } from '@main/core/platform'

let isBridge: boolean | undefined

export function isMacElectronBridgePackage(): boolean {
  if (!app.isPackaged || !isMac) return false
  if (isBridge === undefined) {
    const metadata = JSON.parse(readFileSync(application.getPath('app.root', 'package.json'), 'utf8')) as {
      cherryRegionBridge?: boolean
    }
    isBridge = metadata.cherryRegionBridge === true
  }
  return isBridge
}
