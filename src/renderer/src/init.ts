import KeyvStorage from '@kangfenmao/keyv-storage'

import { startAutoSync, startGistAutoSync } from './services/BackupService'
import store from './store'

function initKeyv() {
  window.keyv = new KeyvStorage()
  window.keyv.init()
}

function initAutoSync() {
  const { webdavAutoSync } = store.getState().settings
  if (webdavAutoSync) {
    startAutoSync()
  }

  const { githubGistAutoSync } = store.getState().settings
  if (githubGistAutoSync) {
    startGistAutoSync()
  }
}

initKeyv()
initAutoSync()
