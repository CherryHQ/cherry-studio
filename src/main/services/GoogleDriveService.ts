import { ipcMain } from 'electron'
import fetch from 'node-fetch'
import { MainIPCHandlers } from '../../@types/main'
import FormData from 'form-data'
import { Readable } from 'stream'

/**
 * Google Drive服务
 * 处理与Google Drive API的交互，包括文件上传、下载和列表获取
 */
export class GoogleDriveService implements MainIPCHandlers {
  constructor() {}

  /**
   * 注册IPC处理程序
   */
  registerHandlers() {
    ipcMain.handle('googleDrive:uploadFile', this.uploadFile)
    ipcMain.handle('googleDrive:downloadFile', this.downloadFile)
    ipcMain.handle('googleDrive:listFiles', this.listFiles)
    ipcMain.handle('googleDrive:refreshToken', this.refreshToken)
  }

  /**
   * 上传文件到Google Drive
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
      // 创建元数据
      const metadata = {
        name: fileName,
        mimeType: 'application/zip',
      }

      // 如果指定了文件夹ID，则添加到元数据中
      if (folderId) {
        metadata['parents'] = [folderId]
      }

      // 创建表单数据
      const form = new FormData()
      form.append('metadata', JSON.stringify(metadata), {
        contentType: 'application/json',
      })
      form.append('file', Readable.from(fileContent), {
        filename: fileName,
        contentType: 'application/zip',
      })

      // 上传文件
      const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: form,
      })

      if (!response.ok) {
        throw new Error(`上传文件失败: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('上传文件到Google Drive错误:', error)
      throw error
    }
  }

  /**
   * 从Google Drive下载文件
   * @param _ IPC事件
   * @param accessToken 访问令牌
   * @param fileId 文件ID
   */
  private downloadFile = async (_: any, accessToken: string, fileId: string) => {
    try {
      // 获取文件元数据
      const metadataResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,size`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!metadataResponse.ok) {
        throw new Error(`获取文件元数据失败: ${metadataResponse.statusText}`)
      }

      const metadata = await metadataResponse.json()

      // 下载文件内容
      const fileResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!fileResponse.ok) {
        throw new Error(`下载文件失败: ${fileResponse.statusText}`)
      }

      const fileBuffer = await fileResponse.buffer()

      return {
        fileName: metadata.name,
        fileSize: metadata.size,
        content: fileBuffer,
      }
    } catch (error) {
      console.error('从Google Drive下载文件错误:', error)
      throw error
    }
  }

  /**
   * 列出Google Drive中的文件
   * @param _ IPC事件
   * @param accessToken 访问令牌
   * @param folderId 文件夹ID（可选）
   */
  private listFiles = async (_: any, accessToken: string, folderId?: string) => {
    try {
      let url = 'https://www.googleapis.com/drive/v3/files?q=mimeType="application/zip"&fields=files(id,name,size,modifiedTime)'

      // 如果指定了文件夹ID，则添加到查询中
      if (folderId) {
        url += `&q='${folderId}' in parents`
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!response.ok) {
        throw new Error(`获取文件列表失败: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('获取Google Drive文件列表错误:', error)
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
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET || ''
      const tokenUrl = 'https://oauth2.googleapis.com/token'
      
      const params = new URLSearchParams()
      params.append('refresh_token', refreshToken)
      params.append('client_id', clientId)
      params.append('client_secret', clientSecret)
      params.append('grant_type', 'refresh_token')

      const response = await fetch(tokenUrl, {
        method: 'POST',
        body: params,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      if (!response.ok) {
        throw new Error(`刷新令牌失败: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('刷新Google Drive令牌错误:', error)
      throw error
    }
  }
} 