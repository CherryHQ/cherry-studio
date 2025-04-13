import { promises as fs } from 'fs'
import path from 'path'
import { getConfigDir } from '../utils/file'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'
import log from 'electron-log'

// 定义记忆文件路径
const memoryDataPath = path.join(getConfigDir(), 'memory-data.json')

export class MemoryFileService {
  constructor() {
    this.ensureMemoryFileExists()
    this.registerIpcHandlers()
  }

  private async ensureMemoryFileExists() {
    try {
      const directory = path.dirname(memoryDataPath)
      await fs.mkdir(directory, { recursive: true })
      try {
        await fs.access(memoryDataPath)
      } catch (error) {
        // 文件不存在，创建一个空文件
        await fs.writeFile(memoryDataPath, JSON.stringify({
          memoryLists: [],
          memories: [],
          shortMemories: []
        }, null, 2))
      }
    } catch (error) {
      log.error('Failed to ensure memory file exists:', error)
    }
  }

  private registerIpcHandlers() {
    // 读取记忆数据
    ipcMain.handle(IpcChannel.Memory_LoadData, async () => {
      try {
        const data = await fs.readFile(memoryDataPath, 'utf-8')
        return JSON.parse(data)
      } catch (error) {
        log.error('Failed to load memory data:', error)
        return null
      }
    })

    // 保存记忆数据
    ipcMain.handle(IpcChannel.Memory_SaveData, async (_, data) => {
      try {
        await fs.writeFile(memoryDataPath, JSON.stringify(data, null, 2))
        return true
      } catch (error) {
        log.error('Failed to save memory data:', error)
        return false
      }
    })
  }
}

// 创建单例实例
export const memoryFileService = new MemoryFileService()
