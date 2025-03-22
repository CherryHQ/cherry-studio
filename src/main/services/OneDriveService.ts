import { ipcMain } from 'electron'
import fetch from 'node-fetch'
import { MainIPCHandlers } from '../../@types/main'

/**
 * OneDrive服务
 * 处理与Microsoft OneDrive API的交互，包括文件上传、下载和列表获取
 */
export class OneDriveService implements MainIPCHandlers {
  constructor() {}

  /**
   * 注册IPC处理程序
   */
  registerHandlers() {
    ipcMain.handle('oneDrive:uploadFile', this.uploadFile)
    ipcMain.handle('oneDrive:downloadFile', this.downloadFile)
    ipcMain.handle('oneDrive:listFiles', this.listFiles)
    ipcMain.handle('oneDrive:refreshToken', this.refreshToken)
  }

  /**
   * 上传文件到OneDrive
   * @param _ IPC事件
   * @param accessToken 访问令牌
   * @param fileContent 文件内容
   * @param fileName 文件名
   * @param folderId 目标文件夹ID（可选）
   */
  private uploadFile = async (
    _: any,
    accessToken: string,
    fileContent: Buffer,
    fileName: string,
    folderId?: string
  ) => {
    try {
      // 构建上传URL
      let uploadUrl = 'https://graph.microsoft.com/v1.0/me/drive/root:/CherryStudio'
      if (folderId) {
        uploadUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}`
      }
      uploadUrl += `/${fileName}:/content`

      // 上传文件
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/zip'
        },
        body: fileContent
      })

      if (!response.ok) {
        throw new Error(`上传文件失败: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('上传文件到OneDrive错误:', error)
      throw error
    }
  }

  /**
   * 从OneDrive下载文件
   * @param _ IPC事件
   * @param accessToken 访问令牌
   * @param fileId 文件ID
   */
  private downloadFile = async (_: any, accessToken: string, fileId: string) => {
    try {
      // 获取文件元数据
      const metadataResponse = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })

      if (!metadataResponse.ok) {
        throw new Error(`获取文件元数据失败: ${metadataResponse.statusText}`)
      }

      const metadata = await metadataResponse.json()

      // 下载文件内容
      const fileResponse = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })

      if (!fileResponse.ok) {
        throw new Error(`下载文件失败: ${fileResponse.statusText}`)
      }

      const fileBuffer = await fileResponse.buffer()

      return {
        fileName: metadata.name,
        fileSize: metadata.size,
        content: fileBuffer
      }
    } catch (error) {
      console.error('从OneDrive下载文件错误:', error)
      throw error
    }
  }

  /**
   * 列出OneDrive中的文件
   * @param _ IPC事件
   * @param accessToken 访问令牌
   * @param folderId 文件夹ID（可选）
   */
  private listFiles = async (_: any, accessToken: string, folderId?: string) => {
    try {
      // 构建查询URL
      let url = 'https://graph.microsoft.com/v1.0/me/drive/root:/CherryStudio:/children'
      if (folderId) {
        url = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children`
      }
      
      // 添加过滤条件，只获取ZIP文件
      url += '?$filter=endswith(name,\'.zip\')&$select=id,name,size,lastModifiedDateTime'

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })

      if (!response.ok) {
        throw new Error(`获取文件列表失败: ${response.statusText}`)
      }

      const result = await response.json()
      
      // 转换成与Google Drive相似的格式
      return {
        files: result.value.map((file: any) => ({
          id: file.id,
          name: file.name,
          size: file.size,
          modifiedTime: file.lastModifiedDateTime
        }))
      }
    } catch (error) {
      console.error('获取OneDrive文件列表错误:', error)
      throw error
    }
  }

  /**
   * 刷新访问令牌
   * @param _ IPC事件
   * @param refreshToken 刷新令牌
   * @param clientId 客户端ID
   */
  private refreshToken = async (_: any, refreshToken: string, clientId: string) => {
    try {
      const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || ''
      const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
      
      const params = new URLSearchParams()
      params.append('refresh_token', refreshToken)
      params.append('client_id', clientId)
      params.append('client_secret', clientSecret)
      params.append('grant_type', 'refresh_token')

      const response = await fetch(tokenUrl, {
        method: 'POST',
        body: params,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      })

      if (!response.ok) {
        throw new Error(`刷新令牌失败: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('刷新OneDrive令牌错误:', error)
      throw error
    }
  }
} 