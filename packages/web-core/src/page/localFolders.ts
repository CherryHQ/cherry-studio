// The desktop's folder dialog for agent workspaces, answered with `showDirectoryPicker()` (Chrome and
// Edge only). The Worker keeps and mounts the folder; when the browser needs the user's permission
// again, a toast asks for it, since only a click in the page can.
import { IpcChannel } from '@shared/IpcChannel'

import type { CoreClient } from '../client/CoreClient'
import { type LocalFolderAccessRequest, PageChannel } from '../worker/protocol'
import { handleInPage } from './electron'
import { pageNotices } from './pageNotices'

const resources = {
  en: {
    translation: {
      unsupported_title: 'Local folders need Chrome or Edge',
      unsupported_description: 'This browser cannot give Cherry Studio access to a folder on your computer.',
      access_title: 'Allow access to “{{name}}”',
      access_description: 'The browser needs your permission again before the agent can use this folder.',
      access_allow: 'Allow',
      access_denied: 'Access to “{{name}}” was not allowed.'
    }
  },
  'zh-CN': {
    translation: {
      unsupported_title: '本地文件夹需要 Chrome 或 Edge',
      unsupported_description: '当前浏览器无法让 Cherry Studio 访问你电脑上的文件夹。',
      access_title: '允许访问“{{name}}”',
      access_description: 'Agent 使用这个文件夹之前，浏览器需要你再次授权。',
      access_allow: '允许',
      access_denied: '未获准访问“{{name}}”。'
    }
  },
  'zh-TW': {
    translation: {
      unsupported_title: '本機資料夾需要 Chrome 或 Edge',
      unsupported_description: '目前的瀏覽器無法讓 Cherry Studio 存取你電腦上的資料夾。',
      access_title: '允許存取「{{name}}」',
      access_description: 'Agent 使用這個資料夾之前，瀏覽器需要你再次授權。',
      access_allow: '允許',
      access_denied: '未獲准存取「{{name}}」。'
    }
  }
}

type PickerWindow = Window & {
  showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>
}
type PermissionHandle = FileSystemDirectoryHandle & {
  requestPermission: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>
}

async function pickFolder(client: CoreClient): Promise<string | null> {
  const picker = (window as PickerWindow).showDirectoryPicker
  if (!picker) {
    const { toast, t } = await pageNotices(resources)
    toast.warning({ title: t('unsupported_title'), description: t('unsupported_description') })
    return null
  }
  let handle: FileSystemDirectoryHandle
  try {
    handle = await picker.call(window, { mode: 'readwrite' })
  } catch (error) {
    // Cancelling the picker answers like cancelling the desktop dialog.
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
  return client.send('local-folder.add', { handle })
}

async function offerAccess(client: CoreClient, folder: LocalFolderAccessRequest): Promise<void> {
  const { toast, t } = await pageNotices(resources)
  toast.warning({
    key: `local-folder-access-${folder.id}`,
    title: t('access_title', { name: folder.name }),
    description: t('access_description'),
    timeout: 0,
    action: {
      label: t('access_allow'),
      onClick: async () => {
        const state = await (folder.handle as PermissionHandle).requestPermission({ mode: 'readwrite' })
        if (state === 'granted') await client.send('local-folder.allow', { id: folder.id })
        else toast.error(t('access_denied', { name: folder.name }))
      }
    }
  })
}

/** Answers the folder dialog in the page and offers access to stored folders the browser asks about. */
export function installLocalFolders(client: CoreClient): void {
  handleInPage(IpcChannel.File_SelectFolder, () => pickFolder(client))
  client.onBroadcast((channel, args) => {
    if (channel === PageChannel.LocalFolderAccess) void offerAccess(client, args[0] as LocalFolderAccessRequest)
  })
}
