import { configManager } from '@main/services/ConfigManager'
import * as Sentry from '@sentry/electron/main'
import { app } from 'electron'

export function initSentry() {
  if (app.isPackaged && configManager.getEnableDataCollection()) {
    Sentry.init({
      dsn: 'https://194ceab3bd44e686bd3ebda9de3c20fd@o4509184559218688.ingest.us.sentry.io/4509184569442304'
    })
  }
}
