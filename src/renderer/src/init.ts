import KeyvStorage from '@kangfenmao/keyv-storage'

import { startAutoSync } from './services/BackupService'
import { loadTTSSettingsFromMain } from './services/SettingsSyncService'
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
    if (webdavAutoSync) {
      startAutoSync()
    }
  }, 2000)
}

function initSettings() {
  // 确保在Redux状态初始化后再加载设置
  setTimeout(async () => {
    console.log('开始初始化设置同步...');
    try {
      // 加载TTS设置
      await loadTTSSettingsFromMain();
    } catch (error) {
      console.error('初始化设置同步失败:', error);
    }
  }, 1000);
}

initSpinner()
initKeyv()
initAutoSync()
initSettings()
