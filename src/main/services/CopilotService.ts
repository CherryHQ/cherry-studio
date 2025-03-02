import axios, { AxiosRequestConfig } from 'axios'
import { app, safeStorage } from 'electron'
import fs from 'fs/promises'
import path from 'path'

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

class CopilotService {
  private readonly GITHUB_CLIENT_ID: string
  private readonly TOKEN_FILE_PATH: string
  private readonly DEFAULT_HEADERS: Record<string, string>

  constructor() {
    this.GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98'
    this.TOKEN_FILE_PATH = path.join(app.getPath('userData'), '.copilot_token')
    this.DEFAULT_HEADERS = {
      accept: 'application/json',
      'editor-version': 'Neovim/0.6.1',
      'editor-plugin-version': 'copilot.vim/1.16.0',
      'content-type': 'application/json',
      'user-agent': 'GithubCopilot/1.155.0',
      'accept-encoding': 'gzip,deflate,br'
    }
    this.getAuthMessage = this.getAuthMessage.bind(this)
    this.getCopilotToken = this.getCopilotToken.bind(this)
    this.saveCopilotToken = this.saveCopilotToken.bind(this)
    this.getToken = this.getToken.bind(this)
  }
  /**
   * 获取GitHub设备授权信息
   */
  public async getAuthMessage(): Promise<AuthResponse> {
    try {
      const response = await axios.post<AuthResponse>(
        'https://github.com/login/device/code',
        {
          client_id: this.GITHUB_CLIENT_ID,
          scope: 'read:user'
        },
        { headers: this.DEFAULT_HEADERS }
      )

      const { device_code, user_code, verification_uri } = response.data
      return { device_code, user_code, verification_uri }
    } catch (error) {
      console.error('Failed to get auth message:', error)
      throw new Error('无法获取GitHub授权信息')
    }
  }

  /**
   * 使用设备码获取访问令牌
   */
  public async getCopilotToken(_: Electron.IpcMainInvokeEvent, device_code: string): Promise<TokenResponse> {
    const maxAttempts = 120 // 2分钟总计 (1秒 * 120)
    const pollingInterval = 1000 // 1秒

    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      await this.delay(pollingInterval)

      try {
        const response = await axios.post<TokenResponse>(
          'https://github.com/login/oauth/access_token',
          {
            client_id: this.GITHUB_CLIENT_ID,
            device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          },
          { headers: this.DEFAULT_HEADERS }
        )

        const { access_token } = response.data
        if (access_token) {
          return { access_token }
        }
      } catch (error) {
        // 仅在最后一次尝试失败时记录错误
        if (attempts === maxAttempts - 1) {
          console.error('Token polling failed:', error)
        }
      }
    }

    throw new Error('获取访问令牌超时，请重试')
  }

  /**
   * 保存Copilot令牌到本地文件
   */
  public async saveCopilotToken(_: Electron.IpcMainInvokeEvent, token: string): Promise<void> {
    try {
      const encryptedToken = safeStorage.encryptString(token)
      await fs.writeFile(this.TOKEN_FILE_PATH, encryptedToken)
    } catch (error) {
      console.error('Failed to save token:', error)
      throw new Error('无法保存访问令牌')
    }
  }

  /**
   * 从本地文件读取令牌并获取Copilot令牌
   */
  public async getToken(): Promise<CopilotTokenResponse> {
    try {
      const encryptedToken = await fs.readFile(this.TOKEN_FILE_PATH)
      const access_token = safeStorage.decryptString(Buffer.from(encryptedToken))

      const config: AxiosRequestConfig = {
        headers: {
          ...this.DEFAULT_HEADERS,
          authorization: `token ${access_token}`
        }
      }

      const response = await axios.get<{ token: string }>('https://api.github.com/copilot_internal/v2/token', config)

      return { token: response.data.token }
    } catch (error) {
      console.error('Failed to get Copilot token:', error)
      throw new Error('无法获取Copilot令牌，请重新授权')
    }
  }

  /**
   * 辅助方法：延迟执行
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export default new CopilotService()
