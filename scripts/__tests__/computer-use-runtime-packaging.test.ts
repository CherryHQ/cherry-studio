import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Arch } from 'electron-builder'
import { afterEach, describe, expect, it } from 'vitest'

import afterPack, { installComputerUseRuntime } from '../packaging/after-pack'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(platform = 'darwin', arch = 'arm64') {
  const root = mkdtempSync(path.join(tmpdir(), 'cherry-runtime-packaging-'))
  roots.push(root)
  const sdk = path.join(root, 'node_modules/@cherrystudio/computer-use')
  const native = path.join(sdk, `node_modules/@cherrystudio/computer-use-${platform}-${arch}`)
  const name =
    platform === 'darwin'
      ? 'Cherry Computer Use.app'
      : platform === 'win32'
        ? 'open-computer-use.exe'
        : 'open-computer-use'
  const executable = platform === 'darwin' ? path.join(name, 'Contents/MacOS/OpenComputerUse') : name
  mkdirSync(path.join(sdk, 'dist'), { recursive: true })
  writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ version: '0.1.1', main: 'dist/index.js' }))
  writeFileSync(path.join(sdk, 'dist/index.js'), '')
  mkdirSync(path.dirname(path.join(native, 'runtime', executable)), { recursive: true })
  writeFileSync(path.join(native, 'package.json'), JSON.stringify({ version: '0.1.1' }))
  writeFileSync(path.join(native, 'runtime', executable), `${platform}-${arch}`)
  chmodSync(path.join(native, 'runtime', executable), 0o755)
  writeFileSync(path.join(native, 'LICENSE'), 'runtime license')
  writeFileSync(path.join(native, 'THIRD_PARTY_NOTICES.md'), 'runtime notices')
  if (platform === 'darwin') writeFileSync(path.join(native, 'runtime', name, 'Contents/Info.plist'), 'bundle identity')
  const resources = path.join(root, 'output', 'resources')
  const context = {
    arch: arch === 'arm64' ? Arch.arm64 : Arch.x64,
    electronPlatformName: platform,
    appOutDir: path.join(root, 'output'),
    packager: {
      projectDir: root,
      platform: { name: platform === 'darwin' ? 'mac' : platform === 'win32' ? 'windows' : 'linux' },
      getResourcesDir: () => resources
    }
  }
  return { root, native, executable, resources, context }
}

describe('packaged Computer Use runtime', () => {
  it.each([
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['win32', 'arm64'],
    ['win32', 'x64'],
    ['linux', 'arm64'],
    ['linux', 'x64']
  ])('installs %s %s outside ASAR without a development checkout', (platform, arch) => {
    const { root, resources, context } = fixture(platform, arch)
    installComputerUseRuntime(context)
    const runtime = path.join(resources, 'computer-use')
    const executable =
      platform === 'darwin'
        ? 'Cherry Computer Use.app/Contents/MacOS/OpenComputerUse'
        : platform === 'win32'
          ? 'open-computer-use.exe'
          : 'open-computer-use'
    expect(readFileSync(path.join(runtime, executable), 'utf8')).toBe(`${platform}-${arch}`)
    expect(readFileSync(path.join(runtime, 'LICENSE'), 'utf8')).toBe('runtime license')
    expect(readFileSync(path.join(runtime, 'THIRD_PARTY_NOTICES.md'), 'utf8')).toBe('runtime notices')
    if (platform === 'darwin')
      expect(readFileSync(path.join(runtime, 'Cherry Computer Use.app/Contents/Info.plist'), 'utf8')).toBe(
        'bundle identity'
      )
    expect(existsSync(path.join(root, '.context'))).toBe(false)
  })

  it('runs the installation in the production afterPack hook', async () => {
    const { resources, context } = fixture()
    await afterPack(context)
    expect(
      existsSync(path.join(resources, 'computer-use/Cherry Computer Use.app/Contents/MacOS/OpenComputerUse'))
    ).toBe(true)
  })

  it('rejects a platform package from a different SDK version', () => {
    const { native, context } = fixture()
    writeFileSync(path.join(native, 'package.json'), JSON.stringify({ version: '0.1.0' }))
    expect(() => installComputerUseRuntime(context)).toThrow(/must match SDK version 0.1.1/)
  })

  it('fails the build when the helper executable is missing', () => {
    const { native, executable, context } = fixture()
    rmSync(path.join(native, 'runtime', executable))
    expect(() => installComputerUseRuntime(context)).toThrow(/OpenComputerUse/)
  })

  it('does not substitute the host architecture for a missing target package', () => {
    const { root, resources } = fixture('darwin', 'arm64')
    const hook = path.resolve(import.meta.dirname, '../packaging/after-pack.js')
    const script = `require(${JSON.stringify(hook)}).installComputerUseRuntime({
      arch: ${Arch.x64}, electronPlatformName: 'darwin', appOutDir: '',
      packager: { projectDir: ${JSON.stringify(root)}, getResourcesDir: () => ${JSON.stringify(resources)} }
    })`
    expect(() =>
      execFileSync(process.execPath, ['-e', script], { stdio: 'pipe', env: { ...process.env, NODE_PATH: '' } })
    ).toThrow(/computer-use-darwin-x64/)
  })
})
