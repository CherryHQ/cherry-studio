import { exec } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { app } from 'electron'
import Logger from 'electron-log'

import { handleProvidersProtocolUrl } from './urlschema/handle-providers'
import { handleMcpProtocolUrl } from './urlschema/mcp-install'
import { windowService } from './WindowService'

export const CHERRY_STUDIO_PROTOCOL = 'cherrystudio'

export function registerProtocolClient(app: Electron.App) {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(CHERRY_STUDIO_PROTOCOL, process.execPath, [process.argv[1]])
    }
  }

  app.setAsDefaultProtocolClient(CHERRY_STUDIO_PROTOCOL)
}

export function handleProtocolUrl(url: string) {
  if (!url) return
  // Process the URL that was used to open the app
  // The url will be in the format: cherrystudio://data?param1=value1&param2=value2

  // Parse the URL and extract parameters
  const urlObj = new URL(url)
  const params = new URLSearchParams(urlObj.search)

  switch (urlObj.hostname.toLowerCase()) {
    case 'mcp':
      handleMcpProtocolUrl(urlObj)
      return
    case 'providers':
      handleProvidersProtocolUrl(urlObj)
      return
  }

  // You can send the data to your renderer process
  const mainWindow = windowService.getMainWindow()

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('protocol-data', {
      url,
      params: Object.fromEntries(params.entries())
    })
  }
}

const execAsync = promisify(exec)

const DESKTOP_FILE_NAME = 'cherrystudio-url-handler.desktop'

/**
 * Sets up deep linking for the AppImage build on Linux by creating a .desktop file.
 * This allows the OS to open cherrystudio:// URLs with this App.
 */
export async function setupAppImageDeepLink(): Promise<void> {
  // Only run on Linux and when packaged as an AppImage
  if (process.platform !== 'linux' || !process.env.APPIMAGE) {
    return
  }

  Logger.info('AppImage environment detected on Linux, setting up deep link.')

  try {
    const appPath = app.getPath('exe')
    if (!appPath) {
      Logger.error('Could not determine App path.')
      return
    }

    const homeDir = app.getPath('home')
    const applicationsDir = path.join(homeDir, '.local', 'share', 'applications')
    const desktopFilePath = path.join(applicationsDir, DESKTOP_FILE_NAME)

    // Ensure the applications directory exists
    await fs.mkdir(applicationsDir, { recursive: true })

    // Content of the .desktop file
    // %U allows passing the URL to the application
    // NoDisplay=true hides it from the regular application menu
    const desktopFileContent = `[Desktop Entry]
Name=Cherry Studio
Exec=${escapePathForExec(appPath)} %U
Terminal=false
Type=Application
MimeType=x-scheme-handler/${CHERRY_STUDIO_PROTOCOL};
NoDisplay=true
`

    // Write the .desktop file (overwrite if exists)
    await fs.writeFile(desktopFilePath, desktopFileContent, 'utf-8')
    Logger.info(`Created/Updated desktop file: ${desktopFilePath}`)

    // Update the desktop database
    // It's important to update the database for the changes to take effect
    try {
      const { stdout, stderr } = await execAsync(`update-desktop-database ${escapePathForExec(applicationsDir)}`)
      if (stderr) {
        Logger.warn(`update-desktop-database stderr: ${stderr}`)
      }
      Logger.info(`update-desktop-database stdout: ${stdout}`)
      Logger.info('Desktop database updated successfully.')
    } catch (updateError) {
      Logger.error('Failed to update desktop database:', updateError)
      // Continue even if update fails, as the file is still created.
    }
  } catch (error) {
    // Log the error but don't prevent the app from starting
    Logger.error('Failed to setup AppImage deep link:', error)
  }
}

/**
 * Escapes a path for safe use within the Exec field of a .desktop file
 * and for shell commands. Handles spaces and potentially other special characters
 * by quoting.
 */
function escapePathForExec(filePath: string): string {
  // Simple quoting for paths with spaces.
  return `'${filePath.replace(/'/g, "'\\''")}'`
}
