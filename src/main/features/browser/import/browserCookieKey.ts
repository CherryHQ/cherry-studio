import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { platform } from 'node:os'

import { application } from '@application'
import type { BrowserImportSource } from '@shared/ipc/schemas/browserImport'
import * as z from 'zod'

import { CookieImportError } from './CookieImportError'

type ChromiumBrowser = Exclude<BrowserImportSource['browser'], 'firefox'>
const storageNames = {
  chrome: { mac: 'Chrome', linux: 'Chrome', application: 'chrome' },
  edge: { mac: 'Microsoft Edge', linux: 'Chromium', application: 'chromium' },
  brave: { mac: 'Brave', linux: 'Brave', application: 'brave' },
  dia: { mac: 'Dia' },
  comet: { mac: 'Comet' },
  vivaldi: { mac: 'Vivaldi', linux: 'Chrome', application: 'chrome' },
  opera: { mac: 'Opera', linux: 'Chromium', application: 'chromium' },
  chromium: { mac: 'Chromium', linux: 'Chromium', application: 'chromium' }
} satisfies Record<ChromiumBrowser, { mac: string; linux?: string; application?: string }>

async function readSecret(command: string, args: string[], signal: AbortSignal, input?: string): Promise<Buffer> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    let value: Buffer | undefined
    let failure: unknown
    const child = execFile(
      command,
      args,
      { encoding: 'buffer', windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024, signal },
      (error, stdout, stderr) => {
        if (signal.aborted) {
          stdout.fill(0)
          failure = signal.reason
        } else if (error) {
          stdout.fill(0)
          const denied =
            error.code === 'EACCES' ||
            (command === 'security' && [36, 51, 128].includes(Number(error.code))) ||
            (command === 'kwallet-query' && error.code === 2) ||
            /org\.freedesktop\.(DBus\.Error\.AccessDenied|Secret\.Error\.Dismissed)/.test(stderr.toString())
          failure = new CookieImportError(
            error.code === 'ENOENT' ? 'key_store_unavailable' : denied ? 'access_denied' : 'key_unavailable'
          )
        } else value = stdout
        stderr.fill(0)
      }
    )
    child.once('close', () => {
      if (failure) reject(failure)
      else if (value) resolve(value)
      else reject(new CookieImportError('key_unavailable'))
    })
    // Child-process errors can include stdout/stderr; never propagate those secret-bearing errors.
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(input)
  })
}

function trimLineEnding(secret: Buffer): Buffer {
  let end = secret.length
  if (secret[end - 1] === 10) end--
  if (secret[end - 1] === 13) end--
  return secret.subarray(0, end)
}

export async function readBrowserCookiePassword(browser: ChromiumBrowser, signal: AbortSignal): Promise<Buffer> {
  const names = storageNames[browser]
  if (platform() === 'darwin') {
    const password = trimLineEnding(
      await readSecret(
        'security',
        ['find-generic-password', '-w', '-a', names.mac, '-s', `${names.mac} Safe Storage`],
        signal
      )
    )
    if (!password.length) throw new CookieImportError('key_unavailable')
    return password
  }

  if (!('application' in names)) throw new CookieImportError('key_store_unavailable')
  const secretService = () => readSecret('secret-tool', ['lookup', 'application', names.application], signal)
  const kwallet = async () => {
    const version = process.env.KDE_SESSION_VERSION === '6' ? '6' : '5'
    const wallet = await readSecret(
      'dbus-send',
      [
        '--session',
        '--print-reply=literal',
        `--dest=org.kde.kwalletd${version}`,
        `/modules/kwalletd${version}`,
        'org.kde.KWallet.networkWallet'
      ],
      signal
    )
    const walletName = wallet.toString('utf8').trim()
    if (!walletName) throw new CookieImportError('key_unavailable')
    return trimLineEnding(
      await readSecret(
        'kwallet-query',
        ['--read-password', `${names.linux} Safe Storage`, '--folder', `${names.linux} Keys`, '--', walletName],
        signal
      )
    )
  }
  const kde = process.env.XDG_CURRENT_DESKTOP?.split(':').includes('KDE') || !!process.env.KDE_FULL_SESSION
  const readers = kde ? [kwallet, secretService] : [secretService, kwallet]
  let failure = new CookieImportError('key_unavailable')
  for (const read of readers) {
    try {
      const password = await read()
      if (password.length) return password
      failure = new CookieImportError('key_unavailable')
    } catch (error) {
      signal.throwIfAborted()
      if (!(error instanceof CookieImportError) || error.reason === 'access_denied') throw error
      failure = error
    }
  }
  throw failure
}

export async function unprotectWindowsData(encrypted: Buffer, signal: AbortSignal): Promise<Buffer> {
  const script = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $data = [Convert]::FromBase64String([Console]::In.ReadToEnd())
  $plain = [Security.Cryptography.ProtectedData]::Unprotect($data, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($plain))
  [Array]::Clear($plain, 0, $plain.Length)
} catch { exit 1 }
`
  const output = await readSecret(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    signal,
    encrypted.toString('base64')
  )
  try {
    return Buffer.from(output.toString('ascii'), 'base64')
  } finally {
    output.fill(0)
  }
}

export async function readWindowsCookieKey(browser: ChromiumBrowser, signal: AbortSignal): Promise<Buffer> {
  let encrypted: Buffer
  try {
    const state = z.object({ os_crypt: z.object({ encrypted_key: z.string().min(1) }) }).parse(
      JSON.parse(
        await readFile(application.getPath(`external.browser.${browser}`, 'Local State'), {
          encoding: 'utf8',
          signal
        })
      )
    )
    encrypted = Buffer.from(state.os_crypt.encrypted_key, 'base64')
    if (encrypted.subarray(0, 5).toString('ascii') !== 'DPAPI') throw new CookieImportError('key_unavailable')
  } catch {
    signal.throwIfAborted()
    throw new CookieImportError('key_unavailable')
  }
  const key = await unprotectWindowsData(encrypted.subarray(5), signal)
  if (key.length !== 32) {
    key.fill(0)
    throw new CookieImportError('key_unavailable')
  }
  return key
}
