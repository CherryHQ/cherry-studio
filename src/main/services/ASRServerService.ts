import { ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { IpcChannel } from '@shared/IpcChannel'
import { app, ipcMain } from 'electron'
import log from 'electron-log'

/**
 * ASR服务器服务，用于管理ASR服务器进程
 */
class ASRServerService {
  private asrServerProcess: ChildProcess | null = null

  /**
   * 注册IPC处理程序
   */
  public registerIpcHandlers(): void {
    // 启动ASR服务器
    ipcMain.handle(IpcChannel.Asr_StartServer, this.startServer.bind(this))

    // 停止ASR服务器
    ipcMain.handle(IpcChannel.Asr_StopServer, this.stopServer.bind(this))
  }

  /**
   * 启动ASR服务器
   * @returns Promise<{success: boolean, pid?: number, error?: string}>
   */
  private async startServer(): Promise<{ success: boolean; pid?: number; error?: string }> {
    try {
      if (this.asrServerProcess) {
        return { success: true, pid: this.asrServerProcess.pid }
      }

      // 获取服务器文件路径
      log.info('App path:', app.getAppPath())
      // 在开发环境和生产环境中使用不同的路径
      let serverPath = ''
      const isPackaged = app.isPackaged

      if (isPackaged) {
        // 生产环境 (打包后) - 使用 extraResources 复制的路径
        // 注意: 'app' 是 extraResources 配置中 'to' 字段的一部分
        serverPath = path.join(process.resourcesPath, 'app', 'asr-server', 'server.js')
        log.info('生产环境，ASR 服务器路径:', serverPath)
      } else {
        // 开发环境 - 指向项目根目录的 asr-server
        serverPath = path.join(app.getAppPath(), 'asr-server', 'server.js')
        log.info('开发环境，ASR 服务器路径:', serverPath)
      }

      // 注意：删除了 isExeFile 检查逻辑, 假设总是用 node 启动
      // Removed unused variable 'isExeFile'
      log.info('ASR服务器路径:', serverPath)

      // 检查文件是否存在
      if (!fs.existsSync(serverPath)) {
        return { success: false, error: '服务器文件不存在' }
      }

      // 启动服务器进程
      // 始终使用 node 启动 server.js
      log.info(`尝试使用 node 启动: ${serverPath}`)
      this.asrServerProcess = spawn('node', [serverPath], {
        stdio: 'pipe', // 'pipe' 用于捕获输出, 如果需要调试可以临时改为 'inherit'
        detached: false // false 通常足够
      })

      // 处理服务器输出
      this.asrServerProcess.stdout?.on('data', (data) => {
        log.info(`[ASR Server] ${data.toString()}`)
      })

      this.asrServerProcess.stderr?.on('data', (data) => {
        log.error(`[ASR Server Error] ${data.toString()}`)
      })

      // 处理服务器退出
      this.asrServerProcess.on('close', (code) => {
        log.info(`[ASR Server] 进程退出，退出码: ${code}`)
        this.asrServerProcess = null
      })

      // 等待一段时间确保服务器启动
      await new Promise((resolve) => setTimeout(resolve, 1000))

      return { success: true, pid: this.asrServerProcess.pid }
    } catch (error) {
      log.error('启动ASR服务器失败:', error)
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * 停止ASR服务器
   * @param _event IPC事件
   * @param pid 进程ID
   * @returns Promise<{success: boolean, error?: string}>
   */
  private async stopServer(
    _event: Electron.IpcMainInvokeEvent,
    pid?: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.asrServerProcess) {
        return { success: true }
      }

      // 检查PID是否匹配
      if (pid && this.asrServerProcess.pid !== pid) {
        log.warn(`请求停止的PID (${pid}) 与当前运行的ASR服务器PID (${this.asrServerProcess.pid}) 不匹配`)
      }

      // 杀死进程
      this.asrServerProcess.kill()

      // 等待一段时间确保进程已经退出
      await new Promise((resolve) => setTimeout(resolve, 500))

      this.asrServerProcess = null
      return { success: true }
    } catch (error) {
      log.error('停止ASR服务器失败:', error)
      return { success: false, error: (error as Error).message }
    }
  }
}

// 导出单例实例
export const asrServerService = new ASRServerService()
