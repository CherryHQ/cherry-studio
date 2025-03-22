import { BrowserWindow, ipcMain } from 'electron'
import fetch from 'node-fetch'
import { MainIPCHandlers } from '../../@types/main'

/**
 * OAuth服务处理OAuth2授权过程
 */
export class OAuthService implements MainIPCHandlers {
  private authWindow: BrowserWindow | null = null

  constructor() {}

  registerHandlers() {
    ipcMain.handle('oauth:open', this.openOAuthWindow)
    ipcMain.handle('oauth:getGoogleDriveToken', this.getGoogleDriveToken)
    ipcMain.handle('oauth:getOneDriveToken', this.getOneDriveToken)
  }

  private openOAuthWindow = async (_: any, url: string) => {
    return new Promise<string>((resolve, reject) => {
      try {
        // 关闭已有的认证窗口
        if (this.authWindow) {
          this.authWindow.close()
          this.authWindow = null
        }

        // 创建新窗口
        this.authWindow = new BrowserWindow({
          width: 800,
          height: 600,
          show: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          }
        })

        // 监听URL变化，捕获回调
        this.authWindow.webContents.on('will-navigate', (event, newUrl) => {
          if (newUrl.startsWith('http://localhost:3333/oauth/callback')) {
            resolve(newUrl)
            this.authWindow?.close()
            this.authWindow = null
          }
        })

        // 处理重定向
        this.authWindow.webContents.on('will-redirect', (event, newUrl) => {
          if (newUrl.startsWith('http://localhost:3333/oauth/callback')) {
            resolve(newUrl)
            this.authWindow?.close()
            this.authWindow = null
          }
        })

        // 窗口关闭事件
        this.authWindow.on('closed', () => {
          this.authWindow = null
          reject(new Error('授权窗口已关闭'))
        })

        // 加载授权URL
        this.authWindow.loadURL(url)
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * 获取Google Drive访问令牌
   */
  private getGoogleDriveToken = async (
    _: any,
    code: string,
    clientId: string,
    redirectUri: string
  ) => {
    try {
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET || ''
      const tokenUrl = 'https://oauth2.googleapis.com/token'
      
      const params = new URLSearchParams()
      params.append('code', code)
      params.append('client_id', clientId)
      params.append('client_secret', clientSecret)
      params.append('redirect_uri', redirectUri)
      params.append('grant_type', 'authorization_code')

      const response = await fetch(tokenUrl, {
        method: 'POST',
        body: params,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      })

      if (!response.ok) {
        throw new Error(`获取Google Drive令牌失败: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('获取Google Drive令牌错误:', error)
      throw error
    }
  }

  /**
   * 获取OneDrive访问令牌
   */
  private getOneDriveToken = async (
    _: any,
    code: string,
    clientId: string,
    redirectUri: string
  ) => {
    try {
      const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || ''
      const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
      
      const params = new URLSearchParams()
      params.append('code', code)
      params.append('client_id', clientId)
      params.append('client_secret', clientSecret)
      params.append('redirect_uri', redirectUri)
      params.append('grant_type', 'authorization_code')

      const response = await fetch(tokenUrl, {
        method: 'POST',
        body: params,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      })

      if (!response.ok) {
        throw new Error(`获取OneDrive令牌失败: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('获取OneDrive令牌错误:', error)
      throw error
    }
  }
} 