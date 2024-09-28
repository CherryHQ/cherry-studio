import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import dayjs from 'dayjs'
import localforage from 'localforage'
import store from '@renderer/store'

import { createClient } from 'webdav'

export async function backup() {
  const version = 3
  const time = new Date().getTime()

  const data = {
    time,
    version,
    localStorage,
    indexedDB: await backupDatabase()
  }

  const filename = `cherry-studio.${dayjs().format('YYYYMMDDHHmm')}`
  const fileContnet = JSON.stringify(data)

  const selectFolder = await window.api.file.selectFolder()

  if (selectFolder) {
    await window.api.backup.save(fileContnet, filename, selectFolder)
    window.message.success({ content: i18n.t('message.backup.success'), key: 'backup' })
  }
}

export async function restore() {
  const file = await window.api.file.open({ filters: [{ name: '备份文件', extensions: ['bak', 'zip'] }] })

  if (file) {
    try {
      let data: Record<string, any> = {}

      // zip backup file
      if (file?.fileName.endsWith('.zip')) {
        const restoreData = await window.api.backup.restore(file.filePath)
        data = JSON.parse(restoreData.data)
      } else {
        data = JSON.parse(await window.api.decompress(file.content))
      }

      // 处理文件内容
      console.log('Parsed file content:', data)

      await handleData(data)
    } catch (error) {
      console.error(error)
      window.message.error({ content: i18n.t('error.backup.file_format'), key: 'restore' })
    }
  }
}

export async function reset() {
  window.modal.confirm({
    title: i18n.t('common.warning'),
    content: i18n.t('message.reset.confirm.content'),
    centered: true,
    onOk: async () => {
      window.modal.confirm({
        title: i18n.t('message.reset.double.confirm.title'),
        content: i18n.t('message.reset.double.confirm.content'),
        centered: true,
        onOk: async () => {
          await localStorage.clear()
          await localforage.clear()
          await clearDatabase()
          await window.api.file.clear()
          window.api.reload()
        }
      })
    }
  })
}

// 备份到 webdav
export async function backupToWebdav() {
  // 先走之前的 backup 流程，存储到临时文件
  const version = 3
  const time = new Date().getTime()

  const data = {
    time,
    version,
    localStorage,
    indexedDB: await backupDatabase()
  }

  const filename = `cherry-studio.backup.json`
  const fileContent = JSON.stringify(data)

  // 获取 userSetting 里的 WebDAV 配置
  const { webdavHost, webdavUser, webdavPass, webdavPath } = store.getState().settings
  // console.log('backup.backupToWebdav', webdavHost, webdavUser, webdavPass, webdavPath)

  let host = webdavHost
  if (!host.startsWith('http://') && !host.startsWith('https://')) {
    host = `http://${host}`
  }
  console.log('backup.backupToWebdav', host)

  // 创建 WebDAV 客户端
  const client = createClient(
    host, // WebDAV 服务器地址
    {
      username: webdavUser, // 用户名
      password: webdavPass // 密码
    }
  )

  // 上传文件到 WebDAV
  const remoteFilePath = `${webdavPath}/${filename}`

  // 先检查创建目录
  try {
    if (!(await client.exists(webdavPath))) {
      await client.createDirectory(webdavPath)
    }
  } catch (error) {
    console.error('Error creating directory on WebDAV:', error)
  }

  // 上传文件
  try {
    await client.putFileContents(remoteFilePath, fileContent, { overwrite: true })
    console.log('File uploaded successfully!')
    window.message.success({ content: i18n.t('message.backup.success'), key: 'backup' })
  } catch (error) {
    console.error('Error uploading file to WebDAV:', error)
  }
}

// 从 webdav 恢复
export async function restoreFromWebdav() {
  const filename = `cherry-studio.backup.json`

  // 获取 userSetting 里的 WebDAV 配置
  const { webdavHost, webdavUser, webdavPass, webdavPath } = store.getState().settings
  // console.log('backup.restoreFromWebdav', webdavHost, webdavUser, webdavPass, webdavPath)

  let host = webdavHost
  if (!host.startsWith('http://') && !host.startsWith('https://')) {
    host = `http://${host}`
  }
  console.log('backup.restoreFromWebdav', host)

  // 创建 WebDAV 客户端
  const client = createClient(
    host, // WebDAV 服务器地址
    {
      username: webdavUser, // 用户名
      password: webdavPass // 密码
    }
  )

  // 上传文件到 WebDAV
  const remoteFilePath = `${webdavPath}/${filename}`

  // 下载文件
  try {
    // 下载文件内容
    const fileContent = await client.getFileContents(remoteFilePath, { format: 'text' })
    console.log('File downloaded successfully!', fileContent)

    // 处理文件内容
    const data = parseFileContent(fileContent.toString())
    console.log('Parsed file content:', data)

    await handleData(data)
  } catch (error) {
    console.error('Error downloading file from WebDAV:', error)
    window.message.error({ content: i18n.t('error.backup.file_format'), key: 'restore' })
  }
}

/************************************* Backup Utils ************************************** */

function parseFileContent(fileContent: string | Buffer | { data: string | Buffer } | ArrayBuffer): any {
  let fileContentString: string

  if (typeof fileContent === 'string') {
    fileContentString = fileContent
  } else if (Buffer.isBuffer(fileContent)) {
    fileContentString = fileContent.toString('utf-8')
  } else if (fileContent instanceof ArrayBuffer) {
    fileContentString = Buffer.from(fileContent).toString('utf-8')
  } else if (fileContent && typeof fileContent.data === 'string') {
    fileContentString = fileContent.data
  } else if (fileContent && Buffer.isBuffer(fileContent.data)) {
    fileContentString = fileContent.data.toString('utf-8')
  } else {
    throw new Error('Unsupported file content type')
  }

  return JSON.parse(fileContentString)
}

async function handleData(data: any) {
  if (data.version === 1) {
    await clearDatabase()

    for (const { key, value } of data.indexedDB) {
      if (key.startsWith('topic:')) {
        await db.table('topics').add({ id: value.id, messages: value.messages })
      }
      if (key === 'image://avatar') {
        await db.table('settings').add({ id: key, value })
      }
    }

    await localStorage.setItem('persist:cherry-studio', data.localStorage['persist:cherry-studio'])
    window.message.success({ content: i18n.t('message.restore.success'), key: 'restore' })
    setTimeout(() => window.api.reload(), 1000)
    return
  }

  if (data.version >= 2) {
    localStorage.setItem('persist:cherry-studio', data.localStorage['persist:cherry-studio'])
    await restoreDatabase(data.indexedDB)
    window.message.success({ content: i18n.t('message.restore.success'), key: 'restore' })
    setTimeout(() => window.api.reload(), 1000)
    return
  }

  window.message.error({ content: i18n.t('error.backup.file_format'), key: 'restore' })
}

async function backupDatabase() {
  const tables = db.tables
  const backup = {}

  for (const table of tables) {
    backup[table.name] = await table.toArray()
  }

  return backup
}

async function restoreDatabase(backup: Record<string, any>) {
  await db.transaction('rw', db.tables, async () => {
    for (const tableName in backup) {
      await db.table(tableName).clear()
      await db.table(tableName).bulkAdd(backup[tableName])
    }
  })
}

async function clearDatabase() {
  const storeNames = await db.tables.map((table) => table.name)

  await db.transaction('rw', db.tables, async () => {
    for (const storeName of storeNames) {
      await db[storeName].clear()
    }
  })
}
