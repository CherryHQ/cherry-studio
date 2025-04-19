import i18n from '@renderer/i18n'

// 使用window.electron而不是直接导入electron模块
// 这样可以避免__dirname不可用的问题

class ASRServerService {
  private serverProcess: any = null
  private isServerRunning = false

  /**
   * 启动ASR服务器
   * @returns Promise<boolean> 是否成功启动
   */
  startServer = async (): Promise<boolean> => {
    if (this.isServerRunning) {
      console.log('[ASRServerService] 服务器已经在运行中')
      // 安全地调用window.message
      if (window.message) {
        window.message.info({ content: i18n.t('settings.asr.server.already_running'), key: 'asr-server' })
      }
      return true
    }

    try {
      console.log('[ASRServerService] 正在启动ASR服务器...')
      // 安全地调用window.message
      if (window.message) {
        window.message.loading({ content: i18n.t('settings.asr.server.starting'), key: 'asr-server' })
      }

      // 使用IPC调用主进程启动服务器
      const result = await window.api.asrServer.startServer()

      if (result.success) {
        this.isServerRunning = true
        this.serverProcess = result.pid
        console.log('[ASRServerService] ASR服务器启动成功，PID:', result.pid)
        if (window.message) {
          window.message.success({ content: i18n.t('settings.asr.server.started'), key: 'asr-server' })
        }
        return true
      } else {
        console.error('[ASRServerService] ASR服务器启动失败:', result.error)
        if (window.message) {
          window.message.error({
            content: i18n.t('settings.asr.server.start_failed') + ': ' + result.error,
            key: 'asr-server'
          })
        }
        return false
      }
    } catch (error) {
      console.error('[ASRServerService] 启动ASR服务器时出错:', error)
      if (window.message) {
        window.message.error({
          content: i18n.t('settings.asr.server.start_failed') + ': ' + (error as Error).message,
          key: 'asr-server'
        })
      }
      return false
    }
  }

  /**
   * 停止ASR服务器
   * @returns Promise<boolean> 是否成功停止
   */
  stopServer = async (): Promise<boolean> => {
    if (!this.isServerRunning || !this.serverProcess) {
      console.log('[ASRServerService] 服务器未运行')
      if (window.message) {
        window.message.info({ content: i18n.t('settings.asr.server.not_running'), key: 'asr-server' })
      }
      return true
    }

    try {
      console.log('[ASRServerService] 正在停止ASR服务器...')
      if (window.message) {
        window.message.loading({ content: i18n.t('settings.asr.server.stopping'), key: 'asr-server' })
      }

      // 使用IPC调用主进程停止服务器
      const result = await window.api.asrServer.stopServer(this.serverProcess)

      if (result.success) {
        this.isServerRunning = false
        this.serverProcess = null
        console.log('[ASRServerService] ASR服务器已停止')
        if (window.message) {
          window.message.success({ content: i18n.t('settings.asr.server.stopped'), key: 'asr-server' })
        }
        return true
      } else {
        console.error('[ASRServerService] ASR服务器停止失败:', result.error)
        if (window.message) {
          window.message.error({
            content: i18n.t('settings.asr.server.stop_failed') + ': ' + result.error,
            key: 'asr-server'
          })
        }
        return false
      }
    } catch (error) {
      console.error('[ASRServerService] 停止ASR服务器时出错:', error)
      if (window.message) {
        window.message.error({
          content: i18n.t('settings.asr.server.stop_failed') + ': ' + (error as Error).message,
          key: 'asr-server'
        })
      }
      return false
    }
  }

  /**
   * 检查ASR服务器是否正在运行
   * @returns boolean 是否正在运行
   */
  isRunning = (): boolean => {
    return this.isServerRunning
  }

  /**
   * 获取ASR服务器网页URL
   * @returns string 网页URL
   */
  getServerUrl = (): string => {
    console.log('[ASRServerService] 获取服务器URL: http://localhost:34515')
    return 'http://localhost:34515'
  }

  /**
   * 获取ASR服务器文件路径
   * @returns string 服务器文件路径
   */
  getServerFilePath = (): string => {
    // 使用相对路径，因为window.electron.app.getAppPath()不可用
    return process.env.NODE_ENV === 'development'
      ? 'src/renderer/src/assets/asr-server/server.js'
      : 'public/asr-server/server.js'
  }

  /**
   * 打开ASR服务器网页
   */
  openServerPage = (): void => {
    window.open(this.getServerUrl(), '_blank')
  }
}

export default new ASRServerService()
