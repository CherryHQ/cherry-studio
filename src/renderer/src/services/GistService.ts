import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { setGistSyncState } from '@renderer/store/runtime'
import { setGithubGistId } from '@renderer/store/settings'
import { Buffer } from 'buffer'

import { getBackupData, handleData } from './BackupService'

const GIST_BACKUP_DATA_FILE = 'cherry-studio-backup.zip'

let isGistBackupRunning = false
let gistSyncTimeout: NodeJS.Timeout | null = null
let isGistAutoBackupRunning = false

async function createNewGist(token: string): Promise<string> {
  const response = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`
    },
    body: JSON.stringify({
      description: 'Cherry Studio Backup Storage',
      public: false,
      files: {
        [GIST_BACKUP_DATA_FILE]: {
          content: 'Cherry Studio Backup Storage'
        }
      }
    })
  })

  if (!response.ok) {
    throw new Error(`Failed to create gist: ${response.statusText}`)
  }

  const data = await response.json()
  return data.id
}

// 删除 Gist 中的所有文件
async function clearGistFiles(token: string, gistId: string) {
  const response = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: {
      Authorization: `token ${token}`
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to get gist: ${response.statusText}`)
  }

  const data = await response.json()
  const files = data.files

  const deleteFiles: Record<string, null> = {}
  for (const filename in files) {
    deleteFiles[filename] = null
  }

  const deleteResponse = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `token ${token}`
    },
    body: JSON.stringify({
      files: deleteFiles
    })
  })

  if (!deleteResponse.ok) {
    throw new Error(`Failed to delete gist files: ${deleteResponse.statusText}`)
  }
}

// 备份到 GitHub Gist
export async function backupToGist() {
  const { githubToken, githubGistId } = store.getState().settings

  if (!githubToken) {
    window.message.error({ content: i18n.t('settings.data.gist.invalid_github_token'), key: 'backup' })
    return
  }

  if (isGistBackupRunning) {
    return
  }

  isGistBackupRunning = true
  store.dispatch(setGistSyncState({ syncing: true, lastSyncError: null }))

  try {
    let gistId = githubGistId
    if (!gistId) {
      gistId = await createNewGist(githubToken)
      store.dispatch(setGithubGistId(gistId))
      window.message.success({ content: i18n.t('settings.data.gist.gist_created'), key: 'gist-create' })
    } else {
      await clearGistFiles(githubToken, gistId)
    }

    const backupData = await getBackupData()
    const backupFile = await window.api.backup.backup(GIST_BACKUP_DATA_FILE, backupData)
    const fileContent = await window.api.file.readRaw(backupFile)
    const base64Content = Buffer.from(fileContent).toString('base64')
    await updateGistFile(githubToken, gistId, GIST_BACKUP_DATA_FILE, base64Content)

    store.dispatch(setGistSyncState({ lastSyncTime: Date.now(), lastSyncError: null }))
    window.message.success({ content: i18n.t('settings.data.gist.backup.success'), key: 'backup' })
  } catch (error: any) {
    console.error('[backup] backupToGithub: Error uploading to Github:', error)
    store.dispatch(setGistSyncState({ lastSyncError: error.message }))
    window.message.error({ content: error.message, key: 'backup' })
  } finally {
    isGistBackupRunning = false
    store.dispatch(setGistSyncState({ syncing: false }))
  }
}

// 从 GitHub Gist 恢复
export async function restoreFromGist() {
  const { githubToken, githubGistId } = store.getState().settings

  if (!githubToken || !githubGistId) {
    window.message.error({ content: i18n.t('settings.data.gist.invalid_github_settings'), key: 'restore' })
    return
  }

  store.dispatch(setGistSyncState({ syncing: true, lastSyncError: null }))

  try {
    const gistFiles = await getGistFile(githubToken, githubGistId)
    const backupData = await getGistFileContent(githubToken, gistFiles[GIST_BACKUP_DATA_FILE].raw_url)
    const data = await window.api.backup.restoreFromGist(Buffer.from(backupData, 'base64'))
    await handleData(JSON.parse(data))
  } catch (error: any) {
    console.error('[backup] restoreFromGithub: Error downloading from Github:', error)
    store.dispatch(setGistSyncState({ lastSyncError: error.message }))
    window.modal.error({
      title: i18n.t('message.restore.failed'),
      content: error.message
    })
  } finally {
    store.dispatch(setGistSyncState({ syncing: false }))
  }
}

// 更新 Gist 文件
async function updateGistFile(token: string, gistId: string, filename: string, content: string) {
  const response = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `token ${token}`
    },
    body: JSON.stringify({
      files: {
        [filename]: {
          content
        }
      }
    })
  })

  if (!response.ok) {
    throw new Error(`Failed to update gist file: ${response.statusText}`)
  }
}

async function getGistFile(token: string, gistId: string): Promise<string> {
  const response = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: {
      Authorization: `token ${token}`
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to get gist: ${response.statusText}`)
  }

  const data = await response.json()

  return data.files
}

async function getGistFileContent(token: string, rawUrl: string): Promise<string> {
  const response = await fetch(rawUrl, {
    headers: {
      Authorization: `token ${token}`
    }
  })

  return response.text()
}

// 启动自动备份
export function startGistAutoSync() {
  if (isGistAutoBackupRunning) {
    return
  }

  const { githubGistAutoSync, githubGistSyncInterval } = store.getState().settings
  if (!githubGistAutoSync || !githubGistSyncInterval) {
    return
  }

  isGistAutoBackupRunning = true
  performGistAutoBackup()
}

// 停止自动备份
export function stopGistAutoSync() {
  isGistAutoBackupRunning = false
  if (gistSyncTimeout) {
    clearTimeout(gistSyncTimeout)
    gistSyncTimeout = null
  }
}

// 执行自动备份
async function performGistAutoBackup() {
  if (!isGistAutoBackupRunning) {
    return
  }

  const { githubGistAutoSync, githubGistSyncInterval } = store.getState().settings
  if (!githubGistAutoSync || !githubGistSyncInterval) {
    isGistAutoBackupRunning = false
    return
  }

  try {
    await backupToGist()
  } catch (error) {
    console.error('[AutoBackup] Github backup failed:', error)
  }

  // 安排下一次备份
  gistSyncTimeout = setTimeout(performGistAutoBackup, githubGistSyncInterval * 60 * 1000)
}
