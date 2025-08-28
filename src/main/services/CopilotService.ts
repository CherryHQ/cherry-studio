import { loggerService } from '@logger'
import { app, net, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'

import { getConfigDir } from '../utils/file'

const logger = loggerService.withContext('CopilotService')

// 配置常量，集中管理
const CONFIG = {
  GITHUB_CLIENT_ID: 'Iv1.b507a08c87ecfe98',
  POLLING: {
    MAX_ATTEMPTS: 8,
    INITIAL_DELAY_MS: 1000,
    MAX_DELAY_MS: 16000 // 最大延迟16秒
  },
  DEFAULT_HEADERS: {
    accept: 'application/json',
    'editor-version': 'Neovim/0.6.1',
    'editor-plugin-version': 'copilot.vim/1.16.0',
    'content-type': 'application/json',
    'user-agent': 'GithubCopilot/1.155.0',
    'accept-encoding': 'gzip,deflate,br'
  },
  // API端点集中管理
  API_URLS: {
    GITHUB_USER: 'https://api.github.com/user',
    GITHUB_DEVICE_CODE: 'https://github.com/login/device/code',
    GITHUB_ACCESS_TOKEN: 'https://github.com/login/oauth/access_token',
    COPILOT_TOKEN: 'https://api.github.com/copilot_internal/v2/token'
  },
  TOKEN_FILE_NAME: '.copilot_token'
}

// 接口定义移到顶部，便于查阅
interface UserResponse {
  login: string
  avatar: string
}

interface AuthResponse {
  device_code: string
  user_code: string
  verification_uri: string
}

interface TokenResponse {
  access_token: string
}

interface CopilotTokenResponse {
  token: string
}

// 自定义错误类，统一错误处理
class CopilotServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'CopilotServiceError'
  }
}

class CopilotService {
  private readonly tokenFilePath: string
  private headers: Record<string, string>

  constructor() {
    this.tokenFilePath = this.getTokenFilePath()
    this.headers = {
      ...CONFIG.DEFAULT_HEADERS,
      accept: 'application/json',
      'user-agent': 'Visual Studio Code (desktop)'
    }
  }

  private getTokenFilePath = (): string => {
    const oldTokenFilePath = path.join(app.getPath('userData'), CONFIG.TOKEN_FILE_NAME)
    if (fs.existsSync(oldTokenFilePath)) {
      return oldTokenFilePath
    }
    return path.join(getConfigDir(), CONFIG.TOKEN_FILE_NAME)
  }

  /**
   * 设置自定义请求头
   */
  private updateHeaders = (headers?: Record<string, string>): void => {
    if (headers && Object.keys(headers).length > 0) {
      this.headers = { ...headers }
    }
  }

  /**
   * 获取GitHub登录信息
   */
  public getUser = async (_: Electron.IpcMainInvokeEvent, token: string): Promise<UserResponse> => {
    try {
      const response = await net.fetch(CONFIG.API_URLS.GITHUB_USER, {
        method: 'GET',
        headers: {
          Connection: 'keep-alive',
          'user-agent': 'Visual Studio Code (desktop)',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-Mode': 'no-cors',
          'Sec-Fetch-Dest': 'empty',
          accept: 'application/json',
          authorization: `token ${token}`
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      return {
        login: data.login,
        avatar: data.avatar_url
      }
    } catch (error) {
      logger.error('Failed to get user information:', error as Error)
      throw new CopilotServiceError('无法获取GitHub用户信息', error)
    }
  }

  /**
   * 获取GitHub设备授权信息
   */
  public getAuthMessage = async (
    _: Electron.IpcMainInvokeEvent,
    headers?: Record<string, string>
  ): Promise<AuthResponse> => {
    try {
      this.updateHeaders(headers)

      const response = await net.fetch(CONFIG.API_URLS.GITHUB_DEVICE_CODE, {
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: CONFIG.GITHUB_CLIENT_ID,
          scope: 'read:user'
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return (await response.json()) as AuthResponse
    } catch (error) {
      logger.error('Failed to get auth message:', error as Error)
      throw new CopilotServiceError('无法获取GitHub授权信息', error)
    }
  }

  /**
   * 使用设备码获取访问令牌 - 优化轮询逻辑
   */
  public getCopilotToken = async (
    _: Electron.IpcMainInvokeEvent,
    device_code: string,
    headers?: Record<string, string>
  ): Promise<TokenResponse> => {
    this.updateHeaders(headers)

    let currentDelay = CONFIG.POLLING.INITIAL_DELAY_MS

    for (let attempt = 0; attempt < CONFIG.POLLING.MAX_ATTEMPTS; attempt++) {
      await this.delay(currentDelay)

      try {
        const response = await net.fetch(CONFIG.API_URLS.GITHUB_ACCESS_TOKEN, {
          method: 'POST',
          headers: {
            ...this.headers,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            client_id: CONFIG.GITHUB_CLIENT_ID,
            device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          })
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const data = (await response.json()) as TokenResponse
        const { access_token } = data
        if (access_token) {
          return { access_token }
        }
      } catch (error) {
        // 指数退避策略
        currentDelay = Math.min(currentDelay * 2, CONFIG.POLLING.MAX_DELAY_MS)

        // 仅在最后一次尝试失败时记录详细错误
        const isLastAttempt = attempt === CONFIG.POLLING.MAX_ATTEMPTS - 1
        if (isLastAttempt) {
          logger.error(`Token polling failed after ${CONFIG.POLLING.MAX_ATTEMPTS} attempts:`, error as Error)
        }
      }
    }

    throw new CopilotServiceError('获取访问令牌超时，请重试')
  }

  /**
   * 保存Copilot令牌到本地文件
   */
  public saveCopilotToken = async (_: Electron.IpcMainInvokeEvent, token: string): Promise<void> => {
    try {
      const encryptedToken = safeStorage.encryptString(token)
      // 确保目录存在
      const dir = path.dirname(this.tokenFilePath)
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true })
      }

      await fs.promises.writeFile(this.tokenFilePath, encryptedToken)
    } catch (error) {
      logger.error('Failed to save token:', error as Error)
      throw new CopilotServiceError('无法保存访问令牌', error)
    }
  }

  /**
   * 从本地文件读取令牌并获取Copilot令牌
   */
  public getToken = async (
    _: Electron.IpcMainInvokeEvent,
    headers?: Record<string, string>
  ): Promise<CopilotTokenResponse> => {
    try {
      this.updateHeaders(headers)

      const encryptedToken = await fs.promises.readFile(this.tokenFilePath)
      const access_token = safeStorage.decryptString(Buffer.from(encryptedToken))

      const response = await net.fetch(CONFIG.API_URLS.COPILOT_TOKEN, {
        method: 'GET',
        headers: {
          ...this.headers,
          authorization: `token ${access_token}`
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return (await response.json()) as CopilotTokenResponse
    } catch (error) {
      logger.error('Failed to get Copilot token:', error as Error)
      throw new CopilotServiceError('无法获取Copilot令牌，请重新授权', error)
    }
  }

  /**
   * 退出登录，删除本地token文件
   */
  public logout = async (): Promise<void> => {
    try {
      try {
        await fs.promises.access(this.tokenFilePath)
        await fs.promises.unlink(this.tokenFilePath)
        logger.debug('Successfully logged out from Copilot')
      } catch (error) {
        // 文件不存在不是错误，只是记录一下
        logger.debug('Token file not found, nothing to delete')
      }
    } catch (error) {
      logger.error('Failed to logout:', error as Error)
      throw new CopilotServiceError('无法完成退出登录操作', error)
    }
  }

  /**
   * 辅助方法：延迟执行
   */
  private delay = (ms: number): Promise<void> => {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export default new CopilotService()
