export type S3Config = {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  root?: string
  fileName?: string
  skipBackupFile: boolean
  autoSync: boolean
  syncInterval: number
  maxBackups: number
}

export type WebDavConfig = {
  webdavHost: string
  webdavUser?: string
  webdavPass?: string
  webdavPath?: string
  fileName?: string
  skipBackupFile?: boolean
  disableStream?: boolean
}
