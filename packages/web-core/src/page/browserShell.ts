import { IpcChannel } from '@shared/IpcChannel'

import { answerInPage, handleInPage, sendToPage, shell } from './electron'
import { platform } from './electronToolkitPreload'

/** Schemes the desktop hands to the system; editor links open files on disk, which a page has none of. */
const OPENABLE_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

function openWebsite(url: string): void {
  if (URL.canParse(url) && OPENABLE_SCHEMES.has(new URL(url).protocol)) void shell.openExternal(url)
}

/** Answers the desktop shell's routes with the browser's: links open in a new tab and a reload reloads the page. */
export function installBrowserShell(): void {
  answerInPage('system.shell.open_external_website', openWebsite)
  answerInPage('system.shell.open_website', openWebsite)
  answerInPage('window.main.reload', () => location.reload())
  answerInPage('window.is_full_screen', () => document.fullscreenElement !== null)
  answerInPage('system.get_device_type', () => ({ darwin: 'mac', win32: 'windows', linux: 'linux' })[platform()])
  // A page cannot list installed fonts without asking (Chrome) or at all; the font setting keeps its presets.
  answerInPage('system.get_fonts', () => [])
  // The page is the main window, so a quoted selection goes to its own composer.
  handleInPage(IpcChannel.App_QuoteToMain, async (text) => sendToPage(IpcChannel.App_QuoteToMain, [text]))
}
