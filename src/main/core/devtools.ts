import { application } from '@application'
import { loggerService } from '@logger'
import { isDev } from '@main/core/platform'
import { session } from 'electron'
import { join } from 'path'

const logger = loggerService.withContext('devtools')

/**
 * Install the development-only DevTools extensions (React DevTools + the
 * bundled DataApi DevTools) into the default session.
 *
 * Must be called after the `app` `ready` event, and — per Electron's contract —
 * ideally before the first page loads so the extensions attach to it. Callers
 * fire this without awaiting (best-effort): a slow or failed install (React
 * DevTools may download from the Chrome Web Store on first run) must never
 * block or delay window creation. No-op outside development.
 */
export async function installDevtoolsExtensions(): Promise<void> {
  if (!isDev) return
  await Promise.all([installReactDevtools(), installDataApiDevtools()])
}

async function installReactDevtools() {
  try {
    // Lazy import: electron-devtools-installer calls app.getPath() at module load
    // time, so a static import would run that side effect for anything importing
    // this module (e.g. MainWindowService) — even in production, where this dev-only
    // library is never needed. Importing it here keeps it off the production path.
    const { default: installExtension, REACT_DEVELOPER_TOOLS } = await import('electron-devtools-installer')
    const name = await installExtension(REACT_DEVELOPER_TOOLS)
    logger.info(`Added Extension: ${name}`)
  } catch (error) {
    logger.error('Failed to install React Developer Tools extension', error as Error)
  }
}

async function installDataApiDevtools() {
  try {
    const dataApiDevtoolsPath = join(application.getPath('app.root.resources'), 'devtools', 'data-api')
    // Loads into the default session, so every default-session BrowserWindow can inspect DataApi activity.
    const { name } = await session.defaultSession.extensions.loadExtension(dataApiDevtoolsPath)
    logger.info(`Added Extension: ${name}`)
  } catch (error) {
    logger.error('Failed to install DataApi DevTools extension', error as Error)
  }
}
