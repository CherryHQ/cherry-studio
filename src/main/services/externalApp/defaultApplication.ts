import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { app } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { isLinux, isMac, isWin } from '@main/core/platform'
import type { AbsoluteFilePath } from '@shared/types/file'

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
  '  return JSON.stringify({ name: ObjC.unwrap(name), path: ObjC.unwrap(applicationURL.path) })',
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
  /** Main-process-only application identity; never exposed on ExternalOpenTarget. */
  path?: string
  iconDataUrl?: string
}

export async function resolveDefaultApplication(targetPath: AbsoluteFilePath): Promise<DefaultApplicationInfo | null> {
  try {
    const metadata = await resolveDefaultApplicationMetadata(targetPath)
    if (!metadata) return null

    const iconDataUrl =
      (metadata.path ? await resolveDefaultApplicationIcon(metadata.path) : undefined) ??
      (await resolveDefaultApplicationIcon(targetPath))
    return { ...metadata, ...(iconDataUrl ? { iconDataUrl } : {}) }
  } catch (error) {
    logger.debug('Failed to resolve the system default application', error as Error)
    return null
  }
}

async function resolveDefaultApplicationMetadata(
  targetPath: AbsoluteFilePath
): Promise<Omit<DefaultApplicationInfo, 'iconDataUrl'> | null> {
  if (isMac) {
    const output = await execute('/usr/bin/osascript', [
      '-l',
      'JavaScript',
      '-e',
      MACOS_DEFAULT_APPLICATION_SCRIPT,
      targetPath
    ])
    if (!output) return null
    const metadata: unknown = JSON.parse(output)
    if (!metadata || typeof metadata !== 'object' || !('name' in metadata)) return null
    const { name } = metadata
    if (typeof name !== 'string' || !name.trim()) return null
    const applicationPath = 'path' in metadata ? metadata.path : undefined
    return {
      name,
      ...(typeof applicationPath === 'string' &&
      path.posix.isAbsolute(applicationPath) &&
      !applicationPath.includes('\0')
        ? { path: applicationPath }
        : {})
    }
  }
  const name = await resolveDefaultApplicationName(targetPath)
  return name ? { name } : null
}

async function resolveDefaultApplicationName(targetPath: AbsoluteFilePath): Promise<string | null> {
  if (isWin) {
    const extension = path.extname(targetPath)
    if (!extension) return null
    const encodedName = await execute('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      createWindowsLookupCommand(extension)
    ])
    return encodedName ? decodeBase64Utf8(encodedName) : null
  }
  if (isLinux) return resolveLinuxDefaultApplicationName(targetPath)
  return null
}

function decodeBase64Utf8(value: string): string | null {
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) return null

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()
    return decoded || null
  } catch {
    return null
  }
}

function createWindowsLookupCommand(extension: string): string {
  const extensionBase64 = Buffer.from(extension, 'utf8').toString('base64')
  const script = [
    WINDOWS_DEFAULT_APPLICATION_SCRIPT,
    `$extension = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${extensionBase64}'))`,
    '$name = [AssociationQuery]::GetFriendlyAppName($extension)',
    'if ($name) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($name)) }'
  ].join('\n')
  return Buffer.from(script, 'utf16le').toString('base64')
}

async function resolveDefaultApplicationIcon(subjectPath: string): Promise<string | undefined> {
  try {
    const icon = await app.getFileIcon(subjectPath, { size: 'normal' })
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
  const value = (isMac ? stdout : stdout.replaceAll('\0', '')).trim()
  return value || null
}
