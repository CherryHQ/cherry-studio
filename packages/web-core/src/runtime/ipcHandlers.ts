import { application } from '@application'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { aiHandlers } from '@main/ipc/handlers/ai'
import { dispatchHandle } from '@main/services/file/internal/dispatch'
import type { TreeOwner } from '@main/services/file/tree/DirectoryTreeManager'
import { readByPath, readChunkByPath } from '@main/services/file/utils/content'
import { getMetadataByPath } from '@main/services/file/utils/metadata'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import type { FileHandle } from '@shared/data/types/file'
import { ipcRequestSchemas, type IpcRequestSchemas } from '@shared/ipc/schemas/ipcSchemas'
import type { IpcHandlersFor } from '@shared/ipc/types'

import { version } from '../../../../package.json'
import { isLocalFolderPath } from '../agent/localFolders'
import { unsupported } from '../disabled/unsupported'
import { PAGE_WINDOW_ID } from '../services/WebWindowManager'
import { NATIVE_THEME_CHANNEL } from '../worker/protocol'
import { ipcMain, pageWebContents } from './electron'

// The page reports its `prefers-color-scheme`, which Electron's `nativeTheme` gives the desktop main process.
let nativeTheme: ThemeMode.light | ThemeMode.dark = ThemeMode.light
ipcMain.on(NATIVE_THEME_CHANNEL, (_event, theme) => {
  nativeTheme = theme as typeof nativeTheme
  application.get('IpcApiService').broadcast('system.native_theme_updated', nativeTheme)
})

/** The page owns every directory tree: it is the only window. */
const pageTreeOwner: TreeOwner = {
  windowId: PAGE_WINDOW_ID,
  webContents: pageWebContents as unknown as TreeOwner['webContents']
}

/** Files in the library (attachments) are not served; the file preview reads the agent's files by path. */
const libraryFiles = unsupported('Library files')

/**
 * IpcApi routes the Web edition serves: chat streams, agent creation, tool approvals, the agent
 * session runtime, local-folder workspaces, the agent's file tree and file preview, and Web answers
 * to what the desktop shell asks at start.
 * Archiving and deleting agents, sessions and workspaces need the desktop's workspace archives, which
 * the Web edition does not have yet.
 */
const servedHandlers: Partial<IpcHandlersFor<IpcRequestSchemas>> = {
  'ai.stream.open': aiHandlers['ai.stream.open'],
  'ai.stream.attach': aiHandlers['ai.stream.attach'],
  'ai.stream.detach': aiHandlers['ai.stream.detach'],
  'ai.stream.abort': aiHandlers['ai.stream.abort'],
  'ai.tool.respond_approval': aiHandlers['ai.tool.respond_approval'],
  'ai.agent.create': aiHandlers['ai.agent.create'],
  'ai.agent.restore': aiHandlers['ai.agent.restore'],
  'ai.agent.delete': aiHandlers['ai.agent.delete'],
  'ai.agent.delete_permanently': aiHandlers['ai.agent.delete_permanently'],
  'ai.agent.sessions.delete': aiHandlers['ai.agent.sessions.delete'],
  'ai.agent.session.delete': aiHandlers['ai.agent.session.delete'],
  'ai.agent.session.restore': aiHandlers['ai.agent.session.restore'],
  'ai.agent.session.delete_permanently': aiHandlers['ai.agent.session.delete_permanently'],
  'ai.agent.session.reuse_or_create': aiHandlers['ai.agent.session.reuse_or_create'],
  'ai.agent.session.prewarm': aiHandlers['ai.agent.session.prewarm'],
  'ai.agent.session.close_warm': aiHandlers['ai.agent.session.close_warm'],
  'ai.agent.session.set_pending_input_count': aiHandlers['ai.agent.session.set_pending_input_count'],
  'ai.agent.session.refresh_context_usage': aiHandlers['ai.agent.session.refresh_context_usage'],
  // Edits and forks answer that the runtime cannot fork, as the desktop does for such a runtime.
  'ai.agent.session.edit_target': aiHandlers['ai.agent.session.edit_target'],
  'ai.agent.session.edit_resend': aiHandlers['ai.agent.session.edit_resend'],
  'ai.agent.session.fork': aiHandlers['ai.agent.session.fork'],
  // A workspace the user picks is a stored local folder; the desktop's storage checks need its disk.
  'ai.agent.workspace.register': async ({ path, name }) => {
    if (!isLocalFolderPath(path)) throw new Error(`Not a local folder the user picked: ${path}`)
    return agentWorkspaceService.findOrCreateByPath(path, { name })
  },
  'file.tree.create': ({ rootPath, options }) =>
    application.get('DirectoryTreeManager').create(pageTreeOwner, rootPath, options),
  'file.tree.activate': async ({ treeId, revision }) =>
    application.get('DirectoryTreeManager').activateTree(treeId, revision, pageWebContents.id),
  'file.tree.dispose': async ({ treeId }) => {
    application.get('DirectoryTreeManager').dispose(treeId, pageWebContents.id)
  },
  'file.tree.rename': async ({ treeId, oldPath, newName }) =>
    application.get('DirectoryTreeManager').rename(treeId, oldPath, newName, pageWebContents.id),
  'file.read': async ({ handle, options }) => {
    if (options.mode === 'range') {
      return dispatchHandle(handle as FileHandle, libraryFiles, (path) =>
        readChunkByPath(path, options.offset, options.length)
      )
    }
    return dispatchHandle(handle as FileHandle, libraryFiles, (path) =>
      readByPath(path, { encoding: options.encoding, ...(options.withContentHash && { withContentHash: true }) })
    )
  },
  // A missing or unreadable file is `null`, as on the desktop.
  'file.get_metadata': async (handle) =>
    dispatchHandle(handle as FileHandle, libraryFiles, getMetadataByPath).catch(() => null),
  'app.get_info': async () => ({
    version,
    isPackaged: true,
    appPath: application.getPath('app.root'),
    homePath: application.getPath('sys.home'),
    notesPath: application.getPath('feature.notes.data'),
    configPath: application.getPath('cherry.config'),
    appDataPath: application.getPath('app.userdata'),
    resourcesPath: application.getPath('app.root.resources'),
    logsPath: application.getPath('app.logs'),
    arch: '',
    isPortable: false,
    installPath: application.getPath('app.install')
  }),
  'system.get_native_theme': async () => nativeTheme,
  // The page is the main window, which has no init data; it has no window size, protocol handler or screen capture.
  'window.get_init_data': async () => null,
  'window.main.set_minimum_size': async () => {},
  'window.main.reset_minimum_size': async () => {},
  // Escape asks the window to leave full screen; the browser already does that for its own full screen.
  'window.set_full_screen': async () => {},
  'navigation.protocol_dispatch_ready': async () => {},
  'chat.screenshot.target': async () => {},
  'backup.get_auto_sync_state': async () => ({ pendingNotifications: [] })
}

/** Browser `ipc/handlers/ipcHandlers`: every other route rejects with `WebUnsupportedError`. */
export const ipcHandlers = Object.fromEntries(
  Object.keys(ipcRequestSchemas).map((route) => [
    route,
    servedHandlers[route as keyof IpcRequestSchemas] ?? unsupported(`IpcApi route ${route}`)
  ])
) as IpcHandlersFor<IpcRequestSchemas>
