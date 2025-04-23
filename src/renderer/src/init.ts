import KeyvStorage from '@kangfenmao/keyv-storage'
import * as Sentry from '@sentry/electron/renderer'
import { init as reactInit } from '@sentry/react'

import { startAutoSync } from './services/BackupService'
import { startNutstoreAutoSync } from './services/NutstoreService'
import store from './store'

function initSpinner() {
  const spinner = document.getElementById('spinner')
  if (spinner && window.location.hash !== '#/mini') {
    spinner.style.display = 'flex'
  }
}

function initKeyv() {
  window.keyv = new KeyvStorage()
  window.keyv.init()
}

function initAutoSync() {
  setTimeout(() => {
    const { webdavAutoSync } = store.getState().settings
    const { nutstoreAutoSync } = store.getState().nutstore
    if (webdavAutoSync) {
      startAutoSync()
    }
    if (nutstoreAutoSync) {
      startNutstoreAutoSync()
    }
  }, 8000)
}

export function initSentry() {
  Sentry.init(
    {
      sendDefaultPii: true,
      tracesSampleRate: 1.0,
      integrations: [Sentry.browserTracingIntegration()]
    },
    reactInit as any
  )
}

initSpinner()
initKeyv()
initAutoSync()
