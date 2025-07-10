import KeyvStorage from '@kangfenmao/keyv-storage'

import { startAutoSync, startLocalBackupAutoSync } from './services/BackupService'
import { startNutstoreAutoSync } from './services/NutstoreService'
import storeSyncService from './services/StoreSyncService'
import store from './store'

function initKeyv() {
  window.keyv = new KeyvStorage()
  window.keyv.init()
}

function initAutoSync() {
  setTimeout(() => {
    const { webdavAutoSync, localBackupAutoSync, s3 } = store.getState().settings
    const { nutstoreAutoSync } = store.getState().nutstore
    if (webdavAutoSync || (s3 && s3.autoSync)) {
      startAutoSync()
    }
    if (nutstoreAutoSync) {
      startNutstoreAutoSync()
    }
    if (localBackupAutoSync) {
      startLocalBackupAutoSync()
    }
  }, 8000)
}

function initStoreSync() {
  storeSyncService.subscribe()
}

initKeyv()
initAutoSync()
initStoreSync()
