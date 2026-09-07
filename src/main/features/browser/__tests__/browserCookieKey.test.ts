import * as childProcess from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readBrowserCookiePassword, readWindowsCookieKey, unprotectWindowsData } from '../import/browserCookieKey'

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof childProcess>()),
  execFile: vi.fn()
}))
const realExecFile = (await vi.importActual<typeof childProcess>('node:child_process')).execFile
let root: string
let commands: { command: string; args: string[] }[]
let children: childProcess.ChildProcess[]
let respond: (command: string, args: string[]) => string

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'browser-cookie-key-fixture-'))
  commands = []
  children = []
  respond = () => "process.stdout.write('fixture-password')"
  vi.spyOn(application, 'getPath').mockImplementation((_key, filename) => path.join(root, filename ?? ''))
  vi.spyOn(os, 'platform').mockReturnValue('darwin')
  vi.stubEnv('XDG_CURRENT_DESKTOP', 'GNOME')
  vi.stubEnv('KDE_FULL_SESSION', '')
  vi.stubEnv('KDE_SESSION_VERSION', '')
  // Exercise real pipe, exit and cancellation behavior without accessing any personal key store.
  vi.mocked(childProcess.execFile)
    .mockReset()
    .mockImplementation(((
      command: string,
      args: string[],
      options: childProcess.ExecFileOptions,
      callback: Parameters<typeof realExecFile>[3]
    ) => {
      commands.push({ command, args })
      const child = realExecFile(
        process.execPath,
        ['-e', respond(command, args)],
        {
          ...options,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
        },
        callback
      )
      children.push(child)
      return child
    }) as typeof childProcess.execFile)
})
afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill()
  }
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

describe('Browser encryption keys', () => {
  it.each([
    ['chrome', 'Chrome'],
    ['edge', 'Microsoft Edge'],
    ['brave', 'Brave'],
    ['dia', 'Dia'],
    ['comet', 'Comet'],
    ['vivaldi', 'Vivaldi'],
    ['opera', 'Opera'],
    ['chromium', 'Chromium']
  ] as const)('reads only the %s Safe Storage item and preserves password whitespace', async (browser, name) => {
    respond = () => "process.stdout.write(' password with spaces \\n')"
    expect((await readBrowserCookiePassword(browser, new AbortController().signal)).toString()).toBe(
      ' password with spaces '
    )
    expect(commands).toEqual([
      { command: 'security', args: ['find-generic-password', '-w', '-a', name, '-s', `${name} Safe Storage`] }
    ])
  })

  it.each([
    ['brave', 'brave'],
    ['vivaldi', 'chrome'],
    ['opera', 'chromium'],
    ['chromium', 'chromium']
  ] as const)('uses the %s Secret Service identity on Linux', async (browser, applicationName) => {
    vi.mocked(os.platform).mockReturnValue('linux')
    expect((await readBrowserCookiePassword(browser, new AbortController().signal)).toString()).toBe('fixture-password')
    expect(commands).toEqual([{ command: 'secret-tool', args: ['lookup', 'application', applicationName] }])
  })

  it.each([
    ['vivaldi', 'Chrome'],
    ['opera', 'Chromium'],
    ['chromium', 'Chromium']
  ] as const)('uses the %s KWallet entry on Linux', async (browser, keyringName) => {
    vi.mocked(os.platform).mockReturnValue('linux')
    vi.stubEnv('XDG_CURRENT_DESKTOP', 'KDE')
    respond = (command, args) =>
      command === 'dbus-send'
        ? "process.stdout.write('wallet')"
        : args.includes(`${keyringName} Safe Storage`) && args.includes(`${keyringName} Keys`)
          ? "process.stdout.write('correct-key')"
          : 'process.exit(1)'
    expect((await readBrowserCookiePassword(browser, new AbortController().signal)).toString()).toBe('correct-key')
  })

  it.each(['5', '6'])('reads the configured KDE %s wallet instead of assuming its name', async (version) => {
    vi.mocked(os.platform).mockReturnValue('linux')
    vi.stubEnv('XDG_CURRENT_DESKTOP', 'KDE')
    vi.stubEnv('KDE_SESSION_VERSION', version)
    respond = (command) =>
      command === 'dbus-send'
        ? "process.stdout.write('  custom network wallet  ')"
        : "process.stdout.write('kwallet-fixture\\n')"
    expect((await readBrowserCookiePassword('chrome', new AbortController().signal)).toString()).toBe('kwallet-fixture')
    expect(commands).toEqual([
      {
        command: 'dbus-send',
        args: [
          '--session',
          '--print-reply=literal',
          `--dest=org.kde.kwalletd${version}`,
          `/modules/kwalletd${version}`,
          'org.kde.KWallet.networkWallet'
        ]
      },
      {
        command: 'kwallet-query',
        args: ['--read-password', 'Chrome Safe Storage', '--folder', 'Chrome Keys', '--', 'custom network wallet']
      }
    ])
  })

  it('falls back to Secret Service when no KWallet key exists, but stops on denied access', async () => {
    vi.mocked(os.platform).mockReturnValue('linux')
    vi.stubEnv('XDG_CURRENT_DESKTOP', 'KDE')
    respond = (command) =>
      command === 'dbus-send'
        ? "process.stdout.write('wallet')"
        : command === 'kwallet-query'
          ? 'process.exit(4)'
          : "process.stdout.write('secret-service-fixture')"
    expect((await readBrowserCookiePassword('chrome', new AbortController().signal)).toString()).toBe(
      'secret-service-fixture'
    )
    commands = []
    respond = (command) => (command === 'dbus-send' ? "process.stdout.write('wallet')" : 'process.exit(2)')
    await expect(readBrowserCookiePassword('chrome', new AbortController().signal)).rejects.toMatchObject({
      reason: 'access_denied'
    })
    expect(commands.map(({ command }) => command)).toEqual(['dbus-send', 'kwallet-query'])
  })

  it.each([
    [44, 'key_unavailable'],
    [128, 'access_denied']
  ] as const)('reports Keychain exit %i without leaking tool output', async (code, reason) => {
    respond = () =>
      `process.stdout.write('PRIVATE-OUTPUT'); process.stderr.write('PRIVATE-ERROR'); process.exit(${code})`
    const error = await readBrowserCookiePassword('chrome', new AbortController().signal).catch(
      (error: unknown) => error
    )
    expect(error).toMatchObject({ reason, message: reason })
    expect(JSON.stringify(error)).not.toContain('PRIVATE')
  })

  it('reports a missing system tool separately from a missing key', async () => {
    vi.mocked(childProcess.execFile).mockImplementation(((
      _command: string,
      args: string[],
      options: childProcess.ExecFileOptions,
      callback: Parameters<typeof realExecFile>[3]
    ) => {
      return realExecFile(path.join(root, 'missing-tool'), args, options, callback)
    }) as typeof childProcess.execFile)
    await expect(readBrowserCookiePassword('chrome', new AbortController().signal)).rejects.toMatchObject({
      reason: 'key_store_unavailable'
    })
  })

  it('unwraps only the DPAPI key from Local State, passing ciphertext over stdin', async () => {
    const encrypted = Buffer.from('synthetic-dpapi-ciphertext')
    const key = Buffer.alloc(32, 7)
    await writeFile(
      path.join(root, 'Local State'),
      JSON.stringify({
        os_crypt: { encrypted_key: Buffer.concat([Buffer.from('DPAPI'), encrypted]).toString('base64') }
      })
    )
    respond = () =>
      `let input = ''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => { if (input !== '${encrypted.toString('base64')}') process.exit(1); process.stdout.write('${key.toString('base64')}') })`
    expect(await readWindowsCookieKey('chrome', new AbortController().signal)).toEqual(key)
    expect(commands).toHaveLength(1)
    expect(commands[0].command).toBe('powershell.exe')
    expect(commands[0].args.join(' ')).not.toContain(encrypted.toString('base64'))
    expect(commands[0].args.join(' ')).toContain('DataProtectionScope]::CurrentUser')
    expect(commands[0].args).toContain('-NoProfile')
  })

  it.each(['comet', 'vivaldi', 'opera', 'chromium'] as const)(
    'uses %s Local State instead of another browser key on Windows',
    async (selectedBrowser) => {
      vi.mocked(os.platform).mockReturnValue('win32')
      vi.mocked(application.getPath).mockImplementation((key, filename) => path.join(root, key, filename ?? ''))
      for (const browser of ['chrome', selectedBrowser]) {
        await mkdir(path.join(root, `external.browser.${browser}`))
        await writeFile(
          path.join(root, `external.browser.${browser}`, 'Local State'),
          JSON.stringify({
            os_crypt: { encrypted_key: Buffer.from(`DPAPI${browser}`).toString('base64') }
          })
        )
      }
      const key = Buffer.alloc(32, 17)
      respond = () =>
        `let input = ''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => { if (input !== '${Buffer.from(selectedBrowser).toString('base64')}') process.exit(1); process.stdout.write('${key.toString('base64')}') })`
      expect(await readWindowsCookieKey(selectedBrowser, new AbortController().signal)).toEqual(key)
    }
  )

  it('rejects missing, malformed and app-bound-only Local State without invoking DPAPI', async () => {
    for (const state of [
      '{}',
      '{bad-json',
      JSON.stringify({ os_crypt: { encrypted_key: Buffer.from('APPBfixture').toString('base64') } })
    ]) {
      await writeFile(path.join(root, 'Local State'), state)
      await expect(readWindowsCookieKey('chrome', new AbortController().signal)).rejects.toMatchObject({
        reason: 'key_unavailable'
      })
    }
    expect(commands).toEqual([])
  })

  it('waits for the system helper to exit when import is cancelled', async () => {
    respond = () => 'setInterval(() => {}, 1000)'
    const abort = new AbortController()
    const pending = readBrowserCookiePassword('chrome', abort.signal)
    abort.abort(new Error('import cancelled'))
    await expect(pending).rejects.toThrow('import cancelled')
    expect(children[0].exitCode !== null || children[0].signalCode !== null).toBe(true)
  })
})

// This round trip uses only synthetic input and runs on Windows CI without browser/profile access.
it.runIf(process.platform === 'win32')('unwraps a real current-user Windows DPAPI payload', async () => {
  vi.mocked(childProcess.execFile).mockImplementation(realExecFile)
  const protectedValue = await new Promise<string>((resolve, reject) => {
    realExecFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes('synthetic-cookie-fixture'), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))"
      ],
      { windowsHide: true, timeout: 30_000 },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim()))
    )
  })
  expect(
    (await unprotectWindowsData(Buffer.from(protectedValue, 'base64'), new AbortController().signal)).toString()
  ).toBe('synthetic-cookie-fixture')
})
