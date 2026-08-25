import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { application } from '@application'
import { loggerService } from '@logger'
import { isLinux, isMac, isWin } from '@main/core/platform'
import type { AbsoluteFilePath } from '@shared/types/file'
import { app } from 'electron'

const execFileAsync = promisify(execFile)
const logger = loggerService.withContext('DefaultApplication')
const LOOKUP_TIMEOUT_MS = 3000

const MACOS_DEFAULT_APPLICATION_SCRIPT = [
  'ObjC.import("AppKit")',
  'function run(argv) {',
  '  const fileURL = $.NSURL.fileURLWithPath(argv[0])',
  '  const applicationURL = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL(fileURL)',
  '  if (!applicationURL) return ""',
  '  const name = $.NSFileManager.defaultManager.displayNameAtPath(applicationURL.path)',
  '  return ObjC.unwrap(name)',
  '}'
].join('\n')

const WINDOWS_DEFAULT_APPLICATION_SCRIPT = [
  "Add-Type -TypeDefinition @'",
  'using System;',
  'using System.Runtime.InteropServices;',
  'using System.Text;',
  'public static class AssociationQuery {',
  '  [DllImport("Shlwapi.dll", CharSet = CharSet.Unicode)]',
  '  public static extern uint AssocQueryString(uint flags, uint value, string association, string extra, StringBuilder output, ref uint outputLength);',
  '  public static string GetFriendlyAppName(string extension) {',
  '    uint length = 0;',
  '    AssocQueryString(0, 4, extension, "open", null, ref length);',
  '    if (length == 0) return "";',
  '    var output = new StringBuilder((int)length);',
  '    return AssocQueryString(0, 4, extension, "open", output, ref length) == 0 ? output.ToString() : "";',
  '  }',
  '}',
  "'@"
].join('\n')

export interface DefaultApplicationInfo {
  name: string
  iconDataUrl?: string
}

export async function resolveDefaultApplication(targetPath: AbsoluteFilePath): Promise<DefaultApplicationInfo | null> {
  try {
    const name = await resolveDefaultApplicationName(targetPath)
    if (!name) return null

    const iconDataUrl = await resolveDefaultApplicationIcon(targetPath)
    return { name, ...(iconDataUrl ? { iconDataUrl } : {}) }
  } catch (error) {
    logger.debug('Failed to resolve the system default application', error as Error)
    return null
  }
}

async function resolveDefaultApplicationName(targetPath: AbsoluteFilePath): Promise<string | null> {
  if (isMac) {
    return execute('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MACOS_DEFAULT_APPLICATION_SCRIPT, targetPath])
  }
  if (isWin) {
    const extension = path.extname(targetPath)
    if (!extension) return null
    return execute('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      createWindowsLookupCommand(extension)
    ])
  }
  if (isLinux) return resolveLinuxDefaultApplicationName(targetPath)
  return null
}

function createWindowsLookupCommand(extension: string): string {
  const extensionBase64 = Buffer.from(extension, 'utf8').toString('base64')
  const script = [
    WINDOWS_DEFAULT_APPLICATION_SCRIPT,
    `$extension = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${extensionBase64}'))`,
    '[AssociationQuery]::GetFriendlyAppName($extension)'
  ].join('\n')
  return Buffer.from(script, 'utf16le').toString('base64')
}

async function resolveDefaultApplicationIcon(targetPath: AbsoluteFilePath): Promise<string | undefined> {
  try {
    const icon = await app.getFileIcon(targetPath, { size: 'normal' })
    return icon.isEmpty() ? undefined : icon.toDataURL()
  } catch {
    return undefined
  }
}

async function resolveLinuxDefaultApplicationName(targetPath: AbsoluteFilePath): Promise<string | null> {
  const contentType = await execute('xdg-mime', ['query', 'filetype', targetPath])
  if (!contentType) return null
  const desktopId = await execute('xdg-mime', ['query', 'default', contentType])
  if (!desktopId || path.basename(desktopId) !== desktopId) return null

  for (const directory of getLinuxApplicationDirectories()) {
    try {
      const contents = await readFile(path.join(directory, desktopId), 'utf8')
      const name = contents.match(/^Name=(.+)$/m)?.[1]?.trim()
      if (name) return name
    } catch {
      continue
    }
  }

  return (
    desktopId
      .replace(/\.desktop$/i, '')
      .split('.')
      .at(-1) ?? null
  )
}

function getLinuxApplicationDirectories(): string[] {
  const dataHome = process.env.XDG_DATA_HOME ?? path.join(application.getPath('sys.home'), '.local', 'share')
  const dataDirectories = (process.env.XDG_DATA_DIRS ?? '/usr/local/share:/usr/share').split(path.delimiter)
  return [...new Set([dataHome, ...dataDirectories])].map((directory) => path.join(directory, 'applications'))
}

async function execute(command: string, args: string[]): Promise<string | null> {
  const { stdout } = await execFileAsync(command, args, {
    encoding: 'utf8',
    timeout: LOOKUP_TIMEOUT_MS,
    windowsHide: true
  })
  const value = stdout.trim().replaceAll('\0', '')
  return value || null
}
