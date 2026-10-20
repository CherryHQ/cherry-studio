import { describe, expect, it } from 'vitest'

import { createUtilityProcessEnvironment } from '../host/environment'

const parentEnv = {
  PATH: '/usr/bin',
  TZ: 'Asia/Shanghai',
  LANG: 'zh_CN.UTF-8',
  LC_ALL: 'C',
  HOME: '/Users/me',
  HTTPS_PROXY: 'http://proxy',
  GITHUB_TOKEN: 'secret',
  NODE_OPTIONS: '--inspect',
  NODE_ENV: 'development'
}

describe('createUtilityProcessEnvironment', () => {
  it('builds a non-empty baseline with PATH, locale, TZ, NODE_ENV, and the Cherry temp dir', () => {
    const env = createUtilityProcessEnvironment({ tempDir: '/tmp/cherry', parentEnv, platform: 'darwin' })

    expect(env).toEqual({
      PATH: '/usr/bin',
      TZ: 'Asia/Shanghai',
      LANG: 'zh_CN.UTF-8',
      LC_ALL: 'C',
      NODE_ENV: 'development',
      TMPDIR: '/tmp/cherry',
      TEMP: '/tmp/cherry',
      TMP: '/tmp/cherry'
    })
  })

  it('never passes HOME, proxy variables, tokens, or NODE_OPTIONS', () => {
    const env = createUtilityProcessEnvironment({ tempDir: '/tmp/cherry', parentEnv, platform: 'linux' })
    expect(env).not.toHaveProperty('HOME')
    expect(env).not.toHaveProperty('HTTPS_PROXY')
    expect(env).not.toHaveProperty('GITHUB_TOKEN')
    expect(env).not.toHaveProperty('NODE_OPTIONS')
  })

  it('passes the Windows loader essentials with the parent spelling and the Linux AppImage variables', () => {
    const win = createUtilityProcessEnvironment({
      tempDir: 'C:\\tmp',
      parentEnv: { Path: 'C:\\bin', SystemRoot: 'C:\\Windows', COMSPEC: 'cmd.exe' },
      platform: 'win32'
    })
    expect(win).toMatchObject({
      Path: 'C:\\bin',
      SystemRoot: 'C:\\Windows',
      COMSPEC: 'cmd.exe',
      NODE_ENV: 'production'
    })

    const linux = createUtilityProcessEnvironment({
      tempDir: '/tmp/cherry',
      parentEnv: { PATH: '/bin', LD_LIBRARY_PATH: '/app/lib', APPIMAGE: '/app.AppImage', APPDIR: '/app' },
      platform: 'linux'
    })
    expect(linux).toMatchObject({ LD_LIBRARY_PATH: '/app/lib', APPIMAGE: '/app.AppImage', APPDIR: '/app' })
    const mac = createUtilityProcessEnvironment({
      tempDir: '/tmp/cherry',
      parentEnv: { PATH: '/bin', LD_LIBRARY_PATH: '/app/lib' },
      platform: 'darwin'
    })
    expect(mac).not.toHaveProperty('LD_LIBRARY_PATH')
  })

  it('merges additive definition variables', () => {
    const env = createUtilityProcessEnvironment(
      { tempDir: '/tmp/cherry', parentEnv, platform: 'darwin' },
      {
        ORT_BINDING: '/x/onnx.node'
      }
    )
    expect(env.ORT_BINDING).toBe('/x/onnx.node')
    expect(env.PATH).toBe('/usr/bin')
  })

  it.each([
    ['overrides the baseline', { PATH: '/evil' }],
    ['overrides the baseline case-insensitively', { path: '/evil' }],
    ['overrides the temp dir', { TMPDIR: '/evil' }],
    ['sets NODE_*', { NODE_OPTIONS: '--require x' }],
    ['sets ELECTRON_*', { ELECTRON_RUN_AS_NODE: '1' }],
    ['sets CHERRY_UTILITY_PROCESS_*', { CHERRY_UTILITY_PROCESS_ID: 'x' }],
    ['injects a dynamic library on Linux', { LD_PRELOAD: '/evil.so' }],
    ['injects a dynamic library on macOS', { DYLD_INSERT_LIBRARIES: '/evil.dylib' }],
    ['uses a non-string value', { COUNT: 1 as unknown as string }]
  ])('rejects an addition that %s', (_label, additions) => {
    expect(() =>
      createUtilityProcessEnvironment({ tempDir: '/tmp/cherry', parentEnv, platform: 'darwin' }, additions)
    ).toThrow(TypeError)
  })
})
