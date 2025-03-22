/**
 * 所有主进程处理程序的接口
 */
export interface MainIPCHandlers {
  /**
   * 注册所有IPC处理程序
   */
  registerHandlers(): void;
}

/**
 * OAuth令牌响应对象
 */
export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

/**
 * 文件元数据接口
 */
export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  modifiedTime: string;
}

/**
 * 文件列表响应
 */
export interface FileListResponse {
  files: FileMetadata[];
}

/**
 * 下载文件响应
 */
export interface DownloadFileResponse {
  fileName: string;
  fileSize: number;
  content: Buffer;
}

/**
 * 云存储服务接口
 */
export interface CloudStorageService {
  uploadFile(accessToken: string, fileContent: Buffer, fileName: string, folderId?: string): Promise<any>;
  downloadFile(accessToken: string, fileId: string): Promise<DownloadFileResponse>;
  listFiles(accessToken: string, folderId?: string): Promise<FileListResponse>;
  refreshToken(refreshToken: string, clientId: string): Promise<TokenResponse>;
} 