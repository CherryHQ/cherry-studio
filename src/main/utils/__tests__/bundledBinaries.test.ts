import { execFileSync } from 'node:child_process'

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/Applications/Cherry Studio.app/Contents/Resources/app.asar'),
    isPackaged: false
  }
}))

import { app } from 'electron'

import {
  getClaudeNativePackageCandidates,
  getRipgrepPlatformKey,
  resolveBundledRipgrepPath,
  resolveClaudeExecutablePath
} from '../bundledBinaries'

describe('bundled native binaries', () => {
  beforeEach(() => {
    vi.mocked(app.getAppPath).mockReturnValue('/Applications/Cherry Studio.app/Contents/Resources/app.asar')
    Object.defineProperty(app, 'isPackaged', { configurable: true, value: false })
  })

  it('selects the matching Claude Code native package on Windows', () => {
    expect(getClaudeNativePackageCandidates('win32', 'arm64')).toEqual(['@anthropic-ai/claude-agent-sdk-win32-arm64'])
    expect(getClaudeNativePackageCandidates('win32', 'x64')).toEqual(['@anthropic-ai/claude-agent-sdk-win32-x64'])
  })

  it('does not inspect Linux libc on non-Linux targets', () => {
    const getReportSpy = vi.spyOn(process.report, 'getReport')

    expect(getClaudeNativePackageCandidates('darwin', 'arm64')).toEqual(['@anthropic-ai/claude-agent-sdk-darwin-arm64'])
    expect(getClaudeNativePackageCandidates('win32', 'x64')).toEqual(['@anthropic-ai/claude-agent-sdk-win32-x64'])
    expect(getReportSpy).not.toHaveBeenCalled()

    getReportSpy.mockRestore()
  })

  it('prefers the matching libc and keeps the other Linux package as a fallback', () => {
    expect(getClaudeNativePackageCandidates('linux', 'arm64', 'glibc')).toEqual([
      '@anthropic-ai/claude-agent-sdk-linux-arm64',
      '@anthropic-ai/claude-agent-sdk-linux-arm64-musl'
    ])
    expect(getClaudeNativePackageCandidates('linux', 'x64', 'musl')).toEqual([
      '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
      '@anthropic-ai/claude-agent-sdk-linux-x64'
    ])
  })

  it('rejects unsupported Claude Code native binary targets', () => {
    expect(() => getClaudeNativePackageCandidates('freebsd', 'x64')).toThrow(
      'Bundled Claude Code native binary is not available for freebsd-x64'
    )
    expect(() => getClaudeNativePackageCandidates('win32', 'ia32')).toThrow(
      'Bundled Claude Code native binary is not available for win32-ia32'
    )
  })

  it('maps ripgrep to the target platform and architecture', () => {
    expect(getRipgrepPlatformKey('win32', 'arm64')).toBe('arm64-win32')
    expect(getRipgrepPlatformKey('win32', 'x64')).toBe('x64-win32')
    expect(getRipgrepPlatformKey('darwin', 'arm64')).toBe('arm64-darwin')
    expect(getRipgrepPlatformKey('linux', 'x64')).toBe('x64-linux')
  })

  it('rejects unsupported ripgrep targets', () => {
    expect(() => getRipgrepPlatformKey('freebsd', 'x64')).toThrow('Bundled ripgrep is not available for freebsd-x64')
    expect(() => getRipgrepPlatformKey('win32', 'ia32')).toThrow('Bundled ripgrep is not available for win32-ia32')
  })

  it('resolves installed native executables for the current host', () => {
    expect(resolveClaudeExecutablePath()).toContain('@anthropic-ai+claude-agent-sdk')
    expect(resolveBundledRipgrepPath()).toContain('@cherrystudio+ripgrep')
  })

  it('executes the bundled Claude Code and ripgrep binaries on the current host', () => {
    const claudeVersion = execFileSync(resolveClaudeExecutablePath(), ['--version'], { encoding: 'utf-8' })
    const ripgrepVersion = execFileSync(resolveBundledRipgrepPath(), ['--version'], { encoding: 'utf-8' })

    expect(claudeVersion).toContain('Claude Code')
    expect(ripgrepVersion).toContain('ripgrep')
  })
})
