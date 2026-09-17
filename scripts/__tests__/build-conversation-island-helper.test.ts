import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { buildConversationIslandHelper, resolveSwiftArchitecture } from '../build-conversation-island-helper'

const projectRoot = '/workspace/cherry-studio'

function createFsAdapter() {
  return {
    chmodSync: vi.fn(),
    copyFileSync: vi.fn(),
    mkdirSync: vi.fn()
  }
}

describe('resolveSwiftArchitecture', () => {
  it.each([
    ['arm64', 'arm64'],
    ['x64', 'x86_64']
  ])('maps Node %s to Swift %s', (nodeArch, swiftArch) => {
    expect(resolveSwiftArchitecture(nodeArch)).toBe(swiftArch)
  })

  it('rejects unsupported Node architectures', () => {
    expect(() => resolveSwiftArchitecture('ia32')).toThrow('Unsupported conversation island helper architecture: ia32')
  })
})

describe('buildConversationIslandHelper', () => {
  it('is a no-op outside macOS', () => {
    const execFileSync = vi.fn()
    const fs = createFsAdapter()

    expect(buildConversationIslandHelper({ platform: 'linux', arch: 'x64', execFileSync, fs, projectRoot })).toBe(
      undefined
    )
    expect(execFileSync).not.toHaveBeenCalled()
    expect(fs.mkdirSync).not.toHaveBeenCalled()
    expect(fs.copyFileSync).not.toHaveBeenCalled()
    expect(fs.chmodSync).not.toHaveBeenCalled()
  })

  it.each([
    ['arm64', 'arm64'],
    ['x64', 'x86_64']
  ])('builds and stages the macOS %s helper', (nodeArch, swiftArch) => {
    const fs = createFsAdapter()
    const execFileSync = vi.fn((command: string, args: string[]) => {
      if (command === 'swift' && args.at(-1) === '--show-bin-path') return '/swift/release/bin\n'
      if (command === 'lipo') return `${swiftArch}\n`
      return ''
    })

    const outputPath = buildConversationIslandHelper({
      platform: 'darwin',
      arch: nodeArch,
      execFileSync,
      fs,
      projectRoot
    })

    const buildArgs = [
      'build',
      '--package-path',
      'packages/conversation-island-helper',
      '-c',
      'release',
      '--arch',
      swiftArch
    ]
    const sourcePath = path.join('/swift/release/bin', 'conversation-island-helper')
    const destinationPath = path.join(
      projectRoot,
      'resources',
      'binaries',
      `darwin-${nodeArch}`,
      'conversation-island-helper'
    )

    expect(execFileSync).toHaveBeenNthCalledWith(1, 'swift', buildArgs, {
      cwd: projectRoot,
      stdio: 'inherit'
    })
    expect(execFileSync).toHaveBeenNthCalledWith(2, 'swift', [...buildArgs, '--show-bin-path'], {
      cwd: projectRoot,
      encoding: 'utf8'
    })
    expect(execFileSync).toHaveBeenNthCalledWith(3, 'lipo', ['-archs', sourcePath], { encoding: 'utf8' })
    expect(fs.mkdirSync).toHaveBeenCalledWith(path.dirname(destinationPath), { recursive: true })
    expect(fs.copyFileSync).toHaveBeenCalledWith(sourcePath, destinationPath)
    expect(fs.chmodSync).toHaveBeenCalledWith(destinationPath, 0o755)
    expect(outputPath).toBe(destinationPath)
  })

  it('rejects a helper binary that lacks the target architecture', () => {
    const fs = createFsAdapter()
    const execFileSync = vi.fn((command: string, args: string[]) => {
      if (command === 'swift' && args.at(-1) === '--show-bin-path') return '/swift/release/bin\n'
      if (command === 'lipo') return 'x86_64\n'
      return ''
    })

    expect(() =>
      buildConversationIslandHelper({ platform: 'darwin', arch: 'arm64', execFileSync, fs, projectRoot })
    ).toThrow('conversation-island-helper is missing Mach-O architecture arm64')
    expect(fs.copyFileSync).not.toHaveBeenCalled()
    expect(fs.chmodSync).not.toHaveBeenCalled()
  })
})
