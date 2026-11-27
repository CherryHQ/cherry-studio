import { app } from 'electron'

import { bootConfigService } from '@main/data/bootConfig'

/** Apply the optional local CDP configuration before Electron becomes ready. */
export function configureRemoteDebugging(): void {
  if (!bootConfigService.get('app.remote_debugging.enabled')) return

  if (!app.commandLine.hasSwitch('remote-debugging-port')) {
    app.commandLine.appendSwitch('remote-debugging-port', String(bootConfigService.get('app.remote_debugging.port')))
  }
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
}
