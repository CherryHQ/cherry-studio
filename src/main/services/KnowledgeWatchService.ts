import fs from 'node:fs'
import path from 'node:path'

import chokidar, { FSWatcher } from 'chokidar'
import { app } from 'electron'

import { windowService } from './WindowService'

interface WatchedItem {
  path: string
  name: string
  type: 'file' | 'directory'
  mtime: string
  parentId: string | null
  children?: string[]
}

interface WatchedFiles {
  monitored_files: {
    [key: string]: WatchedItem
  }
}

class KnowledgeWatchService {
  private static instance: KnowledgeWatchService
  private watcher: FSWatcher | null = null
  private watchedFiles: WatchedFiles = {
    monitored_files: {}
  }
  constructor() {
    this.loadConfig()
    this.startWatching()
  }

  public static getInstance(): KnowledgeWatchService {
    if (!KnowledgeWatchService.instance) {
      KnowledgeWatchService.instance = new KnowledgeWatchService()
    }
    return KnowledgeWatchService.instance
  }

  private loadConfig() {
    const storageDir = path.join(app.getPath('userData'), 'Data', 'Files')
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true })
    }
    const knowledgeWatcherPath = path.join(storageDir, 'KnowledgeWatcher.json')
    if (!fs.existsSync(knowledgeWatcherPath)) {
      fs.writeFileSync(knowledgeWatcherPath, JSON.stringify({ monitored_files: {} }, null, 2))
      return
    }
    const data = fs.readFileSync(knowledgeWatcherPath, 'utf-8')
    this.watchedFiles = JSON.parse(data)
  }

  private saveConfig() {
    const storageDir = path.join(app.getPath('userData'), 'Data', 'Files')
    const knowledgeWatcherPath = path.join(storageDir, 'KnowledgeWatcher.json')
    fs.writeFileSync(knowledgeWatcherPath, JSON.stringify(this.watchedFiles, null, 2))
  }
  private async startWatching() {
    this.watcher = chokidar.watch([], {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      }
    })
    this.watcher
      .on('change', (filepath) => this.handleFileChange(filepath))
      .on('unlink', (filepath) => this.handleFileDelete(filepath))
    Object.values(this.watchedFiles.monitored_files).forEach((item) => {
      this.watcher?.add(item.path)
    })
  }
  private findItemsByPath(filepath: string): { id: string; item: WatchedItem }[] {
    return Object.entries(this.watchedFiles.monitored_files)
      .filter(([, item]) => item.path === filepath)
      .map(([id, item]) => ({ id, item }))
  }

  private async handleFileChange(filepath: string) {
    const mainWindow = windowService.getMainWindow()
    const item = this.findItemsByPath(filepath)[0]
    if (!mainWindow) return

    if (item.item.parentId) {
      mainWindow.webContents.send('directory-content-changed', item.item.parentId)
    }
    mainWindow.webContents.send('file-changed', item.id)
    this.saveConfig()
  }
  private async handleFileDelete(filepath: string) {
    const mainWindow = windowService.getMainWindow()
    const foundItem = this.findItemsByPath(filepath)[0]
    if (!mainWindow || !foundItem) return

    const { id, item } = foundItem

    if (item.type === 'file') {
      if (item.parentId) {
        const parent = this.watchedFiles.monitored_files[item.parentId]
        if (parent && parent.children) {
          parent.children = parent.children.filter((childId) => childId !== id)
        }
      }
      delete this.watchedFiles.monitored_files[id]
      if (item.parentId) {
        mainWindow.webContents.send('directory-content-changed', item.parentId)
      } else {
        mainWindow.webContents.send('file-removed', id)
      }
    } else if (item.type === 'directory') {
      if (item.children) {
        item.children.forEach((childId) => {
          delete this.watchedFiles.monitored_files[childId]
        })
      }
      delete this.watchedFiles.monitored_files[id]
      mainWindow.webContents.send('directory-removed', id)
    }

    this.watcher?.unwatch(filepath)
    this.saveConfig()
  }

  public async check() {
    console.debug('[KnowledgeWatchService] Checking....')
    const mainWindow = windowService.getMainWindow()
    if (!mainWindow) return

    const changedItems = new Set<string>() // 存储已经发送过通知的目录ID

    for (const [id, item] of Object.entries(this.watchedFiles.monitored_files)) {
      try {
        const stats = fs.statSync(item.path)
        const currentMtime = stats.mtime.toISOString()

        if (currentMtime !== item.mtime) {
          this.watchedFiles.monitored_files[id].mtime = currentMtime

          if (item.parentId && !changedItems.has(item.parentId)) {
            mainWindow.webContents.send('directory-content-changed', item.parentId)
            changedItems.add(item.parentId)
          } else if (!item.parentId) {
            if (item.type === 'directory') {
              mainWindow.webContents.send('directory-content-changed', id)
              changedItems.add(id)
            } else {
              mainWindow.webContents.send('file-changed', id)
            }
          }
        }
      } catch (error) {
        this.handleFileDelete(item.path)
      }
    }

    if (changedItems.size > 0) {
      this.saveConfig()
    }
    console.debug('[KnowledgeWatchService] Checking done.')
  }
  public async stop() {
    await this.watcher?.close()
    this.watcher = null
  }

  public async add(type: 'directory' | 'file', filePath: string, uniqueId: string, mtime: string, parentId?: string) {
    const existingItem = this.watchedFiles.monitored_files[uniqueId]

    if (existingItem) {
      if (parentId && !existingItem.parentId) {
        existingItem.parentId = parentId
        const parent = this.watchedFiles.monitored_files[parentId]
        if (parent && parent.children) {
          parent.children.push(uniqueId)
        }
      }
      existingItem.mtime = mtime
      this.saveConfig()
      return
    }
    const item: WatchedItem = {
      path: filePath,
      name: path.basename(filePath),
      type: type,
      mtime: mtime,
      parentId: parentId || null
    }

    if (type === 'directory') {
      item.children = []
    }

    if (parentId) {
      const parent = this.watchedFiles.monitored_files[parentId]
      if (parent && parent.children) {
        parent.children.push(uniqueId)
      }
    }

    this.watchedFiles.monitored_files[uniqueId] = item
    this.watcher?.add(filePath)
    this.saveConfig()
  }

  public async remove(uniqueId: string) {
    const item = this.watchedFiles.monitored_files[uniqueId]
    if (!item) return
    if (item.type === 'directory' && item.children) {
      item.children.forEach((childId) => {
        this.remove(childId)
      })
    }
    this.watcher?.unwatch(item.path)
    delete this.watchedFiles.monitored_files[uniqueId]
    this.saveConfig()
  }
}

export const knowledgeWatchService = KnowledgeWatchService.getInstance()
