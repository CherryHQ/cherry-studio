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
      let isExeFile = false

      // 首先检查是否有打包后的exe文件
      const exePath = path.join(app.getAppPath(), 'resources', 'cherry-asr-server.exe')
      if (fs.existsSync(exePath)) {
        serverPath = exePath
        isExeFile = true
        log.info('检测到打包后的exe文件:', serverPath)
      } else if (process.env.NODE_ENV === 'development') {
        // 开发环境
        serverPath = path.join(app.getAppPath(), 'src', 'renderer', 'src', 'assets', 'asr-server', 'server.js')
      } else {
        // 生产环境
        serverPath = path.join(app.getAppPath(), 'public', 'asr-server', 'server.js')
      }
      log.info('ASR服务器路径:', serverPath)

      // 检查文件是否存在
      if (!fs.existsSync(serverPath)) {
        return { success: false, error: '服务器文件不存在' }
      }

      // 启动服务器进程
      if (isExeFile) {
        // 如果是exe文件，直接启动
        this.asrServerProcess = spawn(serverPath, [], {
          stdio: 'pipe',
          detached: false
        })
      } else {
        // 如果是js文件，使用node启动
        this.asrServerProcess = spawn('node', [serverPath], {
          stdio: 'pipe',
          detached: false
        })
      }

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
