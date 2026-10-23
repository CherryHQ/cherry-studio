import childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  inspectWindowsMsvc,
  deriveRuntimeFloor,
  prepareWindowsRuntimeFloor,
  renderRuntimeFloor,
  verifyWindowsRuntimePayload
} from '../packaging/windows-vc-runtime'

const fixture = (build = 35211) => ({
  toolsets: [{ path: 'VS/VC/Tools/MSVC/14.44.35207', version: '14.44.35207' }],
  redists: ['x64', 'arm64'].map((arch) => ({
    path: `VS/VC/Redist/MSVC/v143/vc_redist.${arch}.exe`,
    arch,
    version: [14, 44, build, 0]
  }))
})

// These contracts catch stale/truncated floors and incomplete evidence permitting packaging.
describe('deriveRuntimeFloor', () => {
  it.each([35211, 35212])('tracks the actual servicing build %s rather than an alias folder', (build) => {
    const floor = deriveRuntimeFloor(fixture(build))
    expect(floor).toEqual({ major: 14, minor: 44, build })
    const rendered = renderRuntimeFloor(floor)
    expect(rendered).toBe(
      `!define VC_RUNTIME_MIN_MAJOR 14\n!define VC_RUNTIME_MIN_MINOR 44\n!define VC_RUNTIME_MIN_BUILD ${build}\n!define VC_RUNTIME_MIN_PACKED 917548\n`
    )
    expect(Number(rendered.match(/!define VC_RUNTIME_MIN_PACKED (\d+)/)?.[1])).toBe(917548)
  })

  it('takes numeric maxima across instances and both architectures', () => {
    const inventory = fixture()
    inventory.toolsets.unshift({ path: 'older-instance', version: '14.9.65535' })
    inventory.toolsets.push({ path: 'other-instance', version: '14.40.33807' })
    inventory.redists.unshift({ path: 'older-redist', arch: 'arm64', version: [14, 40, 33810, 0] })
    inventory.redists.push({ path: 'newer-arm64', arch: 'arm64', version: [14, 45, 1, 0] })
    expect(deriveRuntimeFloor(inventory)).toEqual({ major: 14, minor: 45, build: 1 })
  })

  it.each(['x64', 'arm64'])('rejects newer tools than the %s payload', (arch) => {
    const inventory = fixture()
    inventory.toolsets.push({ path: 'new-tools', version: '14.50.36000' })
    inventory.redists.find((entry) => entry.arch !== arch)!.version = [14, 50, 36001, 0]
    expect(() => deriveRuntimeFloor(inventory)).toThrow(
      `VC runtime floor generation failed: ${arch} redistributable 14.44.35211.0 is older than discovered MSVC toolset 14.50.36000; update Visual Studio before packaging.`
    )
  })

  it.each(['x64', 'arm64'])('requires the %s payload even for a common floor', (arch) => {
    const inventory = fixture()
    inventory.redists = inventory.redists.filter((entry) => entry.arch !== arch)
    expect(() => deriveRuntimeFloor(inventory)).toThrow(`missing ${arch} payload`)
  })

  it.each([undefined, {}, { toolsets: [], redists: [] }, { toolsets: null, redists: [] }])(
    'rejects empty inventory %j',
    (inventory) => {
      expect(() => deriveRuntimeFloor(inventory)).toThrow('VC runtime floor generation failed:')
    }
  )

  it.each(['v143', '14.44', '14.44.35207.0', '15.44.35207', '14.65536.1', '14.44.0', '14.-1.1'])(
    'rejects invalid tools %s',
    (version) => {
      const inventory = fixture()
      inventory.toolsets[0].version = version
      expect(() => deriveRuntimeFloor(inventory)).toThrow('VC runtime floor generation failed:')
    }
  )

  it.each([
    [15, 44, 35211, 0],
    [14, -1, 1, 0],
    [14, 65536, 1, 0],
    [14, 44, 0, 0],
    [14, 44, 65536, 0],
    [14, 44, 1.5, 0],
    [14, 44, 35211],
    [14, 44, 35211, -1],
    ['14', 44, 35211, 0]
  ])('rejects malformed payload %j', (...version) => {
    const inventory = fixture()
    inventory.redists[0].version = version as number[]
    expect(() => deriveRuntimeFloor(inventory)).toThrow('VC runtime floor generation failed:')
  })

  it('rejects a nonzero revision instead of truncating it', () => {
    const inventory = fixture()
    inventory.redists[0].version[3] = 1
    expect(() => deriveRuntimeFloor(inventory)).toThrow(
      'VC runtime floor generation failed: redistributable 14.44.35211.1 has a nonzero rebuild component; the installer requires a four-part version check before this payload can be used as its floor.'
    )
  })
})

// Stale output must never rescue failed discovery or a rejected host.
describe('prepareWindowsRuntimeFloor', () => {
  const withTemp = (run: (dir: string, output: string) => void) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-floor-'))
    try {
      run(dir, path.join(dir, 'vc-runtime-version.generated.nsh'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  it('writes current evidence on every successful preparation', () =>
    withTemp((dir, output) => {
      for (const build of [35211, 35212]) {
        const floor = prepareWindowsRuntimeFloor(
          { buildResourcesDir: dir },
          { hostPlatform: 'win32', inspect: () => fixture(build) }
        )
        expect(floor).toEqual({ major: 14, minor: 44, build })
        expect(fs.readFileSync(output, 'utf8')).toBe(renderRuntimeFloor(floor))
      }
    }))

  it.each(['discovery', 'derivation'])('removes stale output before failed %s', (failure) =>
    withTemp((dir, output) => {
      fs.writeFileSync(output, 'stale')
      expect(() =>
        prepareWindowsRuntimeFloor(
          { buildResourcesDir: dir },
          {
            hostPlatform: 'win32',
            inspect: () => {
              expect(fs.existsSync(output)).toBe(false)
              if (failure === 'discovery') throw new Error('PowerShell failed')
              return { toolsets: [], redists: [] }
            }
          }
        )
      ).toThrow(failure === 'discovery' ? 'PowerShell failed' : 'empty inventory')
      expect(fs.existsSync(output)).toBe(false)
    })
  )

  it.each(['darwin', 'linux'])('rejects %s before inventory or any file mutation', (hostPlatform) =>
    withTemp((dir, output) => {
      fs.writeFileSync(output, 'stale')
      expect(() =>
        prepareWindowsRuntimeFloor(
          { buildResourcesDir: dir },
          {
            hostPlatform,
            inspect: () => {
              throw new Error('must not inspect')
            }
          }
        )
      ).toThrow(
        `VC runtime floor generation failed: Windows-target packaging requires a Windows host; cannot verify MSVC on ${hostPlatform}.`
      )
      expect(fs.readFileSync(output, 'utf8')).toBe('stale')
    })
  )

  it('propagates write failure instead of permitting packaging', () =>
    withTemp((dir) => {
      expect(() =>
        prepareWindowsRuntimeFloor(
          { buildResourcesDir: path.join(dir, 'missing') },
          {
            hostPlatform: 'win32',
            inspect: () => fixture()
          }
        )
      ).toThrow(/ENOENT/)
    }))
})

// Command fixtures catch discovery omissions; they do not execute Windows tools.
describe('inspectWindowsMsvc command fixtures', () => {
  let dir: string
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })
  const setup = () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-discovery-'))
    const root = path.join(dir, 'VS')
    for (const key of Object.keys(process.env)) {
      if (
        /^(VCINSTALLDIR|VSINSTALLDIR|VCToolsInstallDir|VCToolsVersion|VCToolsRedistDir|GYP_MSVS_OVERRIDE_PATH|npm_config_msvs_version|CC|CXX|VCTargetsPath|npm_config_msbuild_path|GYP_DEFINES)$/i.test(
          key
        )
      ) {
        vi.stubEnv(key, '')
      }
    }
    vi.stubEnv('ProgramFiles(x86)', dir)
    const put = (file: string) => {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, 'fixture')
      return file
    }
    put(path.join(root, 'VC', 'Tools', 'MSVC', '14.44.35207', 'bin', 'Hostx64', 'x64', 'cl.exe'))
    const payload = (arch: string, exe = true) =>
      put(
        path.join(
          root,
          'VC',
          'Redist',
          'MSVC',
          'v143',
          ...(exe ? [`vc_redist.${arch}.exe`] : [arch, 'Microsoft.VC143.CRT', 'msvcp140.dll'])
        )
      )
    const readPaths: string[] = []
    vi.spyOn(childProcess, 'execFileSync').mockImplementation((file, args) => {
      if (String(file).endsWith('vswhere.exe')) {
        expect(args).toEqual(['-all', '-products', '*', '-prerelease', '-format', 'json'])
        return JSON.stringify([{ installationPath: root }, { installationPath: root }])
      }
      expect(file).toBe('powershell.exe')
      readPaths.push(String(args?.at(-1)))
      return '[14,44,35211,0]'
    })
    return { root, payload, readPaths, put }
  }

  it('prefers EXEs, falls back to CRT DLLs, and deduplicates resolved payloads', () => {
    const { payload, readPaths } = setup()
    const exe = payload('x64')
    const ignoredDll = payload('x64', false)
    const dll = payload('arm64', false)
    const inventory = inspectWindowsMsvc()
    expect(inventory.toolsets).toHaveLength(1)
    expect(inventory.redists.map((entry) => entry.path).sort()).toEqual([exe, dll].sort())
    expect(readPaths.some((command) => command.includes(ignoredDll))).toBe(false)
    expect(deriveRuntimeFloor(inventory)).toEqual({ major: 14, minor: 44, build: 35211 })
  })

  it('fails closed when a newer instance has a dangling child beside its toolset', () => {
    const { root, payload, put } = setup()
    payload('x64')
    payload('arm64')
    const newerRoot = path.join(dir, 'VS-newer')
    const toolsRoot = path.join(newerRoot, 'VC', 'Tools', 'MSVC')
    put(path.join(toolsRoot, '14.50.36000', 'bin', 'Hostx64', 'x64', 'cl.exe'))
    const dangling = path.join(toolsRoot, 'dangling')
    fs.symlinkSync(path.join(dir, 'missing-toolset'), dangling, 'junction')
    vi.mocked(childProcess.execFileSync).mockImplementationOnce(() =>
      JSON.stringify([{ installationPath: root }, { installationPath: newerRoot }])
    )
    let childError: string
    try {
      fs.statSync(dangling)
      throw new Error('fixture must contain a dangling link')
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe('ENOENT')
      childError = (error as Error).message
    }
    expect(() => inspectWindowsMsvc()).toThrow(
      `VC runtime floor generation failed: cannot establish a complete Windows MSVC toolset and redistributable inventory (${childError}); refusing to package with an unverified floor.`
    )
  })

  it.each(['missing vswhere', 'empty instances', 'unreadable payload'])('fails closed on %s', (failure) => {
    const { payload } = setup()
    payload('x64')
    payload('arm64')
    vi.mocked(childProcess.execFileSync).mockImplementation((file) => {
      if (failure === 'missing vswhere') throw new Error('vswhere not found')
      if (failure === 'empty instances') return '[]'
      if (String(file).endsWith('vswhere.exe')) return JSON.stringify([{ installationPath: path.join(dir, 'VS') }])
      throw new Error('FileVersionInfo unreadable')
    })
    expect(() => inspectWindowsMsvc()).toThrow(
      'cannot establish a complete Windows MSVC toolset and redistributable inventory'
    )
  })

  it.each([
    'VCINSTALLDIR',
    'VSINSTALLDIR',
    'VCToolsInstallDir',
    'VCToolsVersion',
    'VCToolsRedistDir',
    'GYP_MSVS_OVERRIDE_PATH',
    'npm_config_msvs_version',
    'CC',
    'CXX',
    'VCTargetsPath',
    'npm_config_msbuild_path',
    'GYP_DEFINES'
  ])('rejects unaccounted %s redirection', (key) => {
    const { payload } = setup()
    payload('x64')
    payload('arm64')
    vi.stubEnv(key, key === 'VCToolsVersion' ? '14.50.36000' : path.join(dir, 'external'))
    expect(() => inspectWindowsMsvc()).toThrow('VC runtime floor generation failed:')
  })

  it('accepts a later VCINSTALLDIR with a trailing separator when the first instance has no VC directory', () => {
    const { root, payload } = setup()
    payload('x64')
    payload('arm64')
    const withoutCpp = path.join(dir, 'VS-without-cpp')
    fs.mkdirSync(withoutCpp)
    vi.mocked(childProcess.execFileSync).mockImplementationOnce(() =>
      JSON.stringify([{ installationPath: withoutCpp }, { installationPath: root }])
    )
    vi.stubEnv('VCINSTALLDIR', path.join(root, 'VC') + path.sep)
    const inventory = inspectWindowsMsvc()
    expect(inventory.toolsets).toEqual([
      { path: fs.realpathSync(path.join(root, 'VC', 'Tools', 'MSVC', '14.44.35207')), version: '14.44.35207' }
    ])
    expect(deriveRuntimeFloor(inventory)).toEqual({ major: 14, minor: 44, build: 35211 })
  })

  it('accepts selection variables that resolve to inventoried roots and versions', () => {
    const { root, payload } = setup()
    payload('x64')
    payload('arm64')
    vi.stubEnv('VSINSTALLDIR', root)
    vi.stubEnv('VCINSTALLDIR', path.join(root, 'VC'))
    vi.stubEnv('VCToolsInstallDir', path.join(root, 'VC', 'Tools', 'MSVC', '14.44.35207'))
    vi.stubEnv('VCToolsVersion', '14.44.35207')
    vi.stubEnv('VCToolsRedistDir', path.join(root, 'VC', 'Redist', 'MSVC', 'v143'))
    vi.stubEnv('GYP_MSVS_OVERRIDE_PATH', root)
    vi.stubEnv('npm_config_msvs_version', root)
    expect(deriveRuntimeFloor(inspectWindowsMsvc())).toEqual({ major: 14, minor: 44, build: 35211 })
  })
})

describe('verifyWindowsRuntimePayload', () => {
  const floor = { major: 14, minor: 51, build: 36247 }
  afterEach(() => vi.restoreAllMocks())

  // Catches packaging a floor newer than the redistributable the installer can download.
  it.each(['x64', 'arm64'])('rejects an insufficient published %s payload with actionable versions', async (arch) => {
    const url = `https://aka.ms/vs/17/release/vc_redist.${arch}.exe`
    await expect(
      verifyWindowsRuntimePayload(floor, {
        arch,
        resolvePayloadVersion: async (requestedUrl) => {
          expect(requestedUrl).toBe(url)
          return [14, 44, 35211, 0]
        }
      })
    ).rejects.toThrow(`${url}: payload 14.44.35211.0 is older than required floor 14.51.36247`)
  })

  // Catches rejecting a sufficient payload or comparing the private component as part of the floor.
  it.each([
    [14, 51, 36247, 0],
    [14, 51, 36247, 1],
    [14, 52, 1, 0]
  ])('accepts sufficient payload %j', async (...version) => {
    await expect(
      verifyWindowsRuntimePayload(floor, { arch: 'x64', resolvePayloadVersion: async () => version })
    ).resolves.toBeUndefined()
  })

  // Catches treating missing or malformed FileVersionInfo as permission to package.
  it.each([undefined, [0, 0, 0, 0], [14, 51, 36247], ['14', 51, 36247, 0]])(
    'fails closed on unreadable version %j',
    async (version) => {
      await expect(
        verifyWindowsRuntimePayload(floor, { arch: 'x64', resolvePayloadVersion: async () => version })
      ).rejects.toThrow('cannot read payload file version')
    }
  )

  // Catches swallowing download or version-reader failures.
  it('propagates resolver rejection with the payload URL', async () => {
    await expect(
      verifyWindowsRuntimePayload(floor, {
        arch: 'arm64',
        resolvePayloadVersion: async () => {
          throw new Error('FileVersionInfo unreadable')
        }
      })
    ).rejects.toThrow('https://aka.ms/vs/17/release/vc_redist.arm64.exe: FileVersionInfo unreadable')
  })

  const stubDownload = (responses: { status: number; location?: string }[]) => {
    const urls: string[] = []
    vi.spyOn(https, 'get').mockImplementation(((url, options, callback) => {
      urls.push(String(url))
      const reply = responses.shift()!
      const response = Object.assign(Readable.from(['downloaded EXE']), {
        statusCode: reply.status,
        headers: { location: reply.location }
      })
      expect(options.signal).toBeInstanceOf(AbortSignal)
      queueMicrotask(() => callback(response))
      return new EventEmitter()
    }) as typeof https.get)
    return urls
  }

  // Catches inspecting the redirect body instead of the downloaded EXE, or leaking a successful download.
  it('follows the aka.ms redirect, reads the EXE file version, and removes the temporary file', async () => {
    const target = 'https://download.visualstudio.microsoft.com/fixture/vc_redist.x64.exe'
    const urls = stubDownload([{ status: 302, location: target }, { status: 200 }])
    let downloadedFile = ''
    vi.spyOn(childProcess, 'execFileSync').mockImplementation((file, args) => {
      expect(file).toBe('powershell.exe')
      const command = String(args?.at(-1))
      downloadedFile = command.match(/GetVersionInfo\('([^']+)'\)/)![1]
      expect(fs.readFileSync(downloadedFile, 'utf8')).toBe('downloaded EXE')
      for (const part of ['FileMajorPart', 'FileMinorPart', 'FileBuildPart', 'FilePrivatePart']) {
        expect(command).toContain(part)
      }
      return '[14,51,36247,0]'
    })
    await verifyWindowsRuntimePayload(floor, { arch: 'x64' })
    expect(urls).toEqual(['https://aka.ms/vs/17/release/vc_redist.x64.exe', target])
    expect(fs.existsSync(path.dirname(downloadedFile))).toBe(false)
  })

  // Catches accepting an error response or following redirects indefinitely.
  it.each([
    { responses: [{ status: 503 }], error: 'HTTP 503' },
    { responses: [{ status: 302 }], error: 'redirect without Location' },
    { responses: [{ status: 302, location: 'https://aka.ms/vs/17/release/vc_redist.x64.exe' }], error: 'redirect loop' }
  ])('fails closed on $error', async ({ responses, error }) => {
    stubDownload(responses)
    await expect(verifyWindowsRuntimePayload(floor, { arch: 'x64' })).rejects.toThrow(error)
  })

  // Catches assuming success on connection failures or ignoring the 60-second download deadline.
  it.each(['network error', 'timeout'])('fails closed on %s', async (failure) => {
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    vi.spyOn(https, 'get').mockImplementation(((_url, options) => {
      const request = new EventEmitter()
      if (failure === 'timeout') {
        options.signal.addEventListener('abort', () => request.emit('error', new Error('download timed out')))
        queueMicrotask(() => controller.abort())
      } else {
        queueMicrotask(() => request.emit('error', new Error('connection reset')))
      }
      return request
    }) as typeof https.get)
    await expect(verifyWindowsRuntimePayload(floor, { arch: 'x64' })).rejects.toThrow(
      failure === 'timeout' ? 'download timed out' : 'connection reset'
    )
    expect(timeout).toHaveBeenCalledWith(60_000)
  })

  // Catches leaving a downloaded EXE behind when PowerShell cannot inspect it.
  it('removes the temporary file when version inspection fails', async () => {
    stubDownload([{ status: 200 }])
    let downloadedFile = ''
    vi.spyOn(childProcess, 'execFileSync').mockImplementation((_file, args) => {
      downloadedFile = String(args?.at(-1)).match(/GetVersionInfo\('([^']+)'\)/)![1]
      throw new Error('PowerShell failed')
    })
    await expect(verifyWindowsRuntimePayload(floor, { arch: 'x64' })).rejects.toThrow('PowerShell failed')
    expect(fs.existsSync(path.dirname(downloadedFile))).toBe(false)
  })
})
