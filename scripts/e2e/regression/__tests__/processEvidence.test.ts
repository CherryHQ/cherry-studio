import { beforeEach, expect, it, vi } from 'vitest'

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }))
vi.mock('node:child_process', () => ({ execFileSync }))

import type { AppRecord } from '../lifecycle'
import { listOwnedProcessIds, observeOwnedProcess } from '../processEvidence'

const record = { platform: 'windows', electronPid: 100 } as AppRecord
const electron = {
  ProcessId: 100,
  ParentProcessId: 1,
  CommandLine: 'electron cherry-studio',
  ExecutablePath: 'C:\\app\\electron.exe'
}
const terminal = {
  ProcessId: 101,
  ParentProcessId: 100,
  CommandLine: 'cmd.exe /c mise exec claude -- claude.exe',
  ExecutablePath: 'C:\\Windows\\System32\\cmd.exe'
}
const claude = {
  ProcessId: 102,
  ParentProcessId: 101,
  CommandLine: '"C:\\isolated profile\\claude.exe" --model test',
  ExecutablePath: 'C:\\isolated profile\\claude.exe'
}

beforeEach(() => execFileSync.mockReset())

it.each([
  { name: 'an owned native executable behind a terminal', process: claude, expected: true },
  { name: 'a different executable with claude.exe in its arguments', process: terminal, expected: false },
  {
    name: 'a mise shim named claude.exe',
    process: { ...claude, ExecutablePath: 'C:\\isolated profile\\shims\\CLAUDE.EXE' },
    expected: false
  },
  { name: 'an unrelated native executable', process: { ...claude, ParentProcessId: 1 }, expected: false },
  { name: 'a process without executable identity', process: { ...claude, ExecutablePath: null }, expected: false },
  {
    name: 'a similarly named executable',
    process: { ...claude, ExecutablePath: 'C:\\tools\\claude-wrapper.exe' },
    expected: false
  },
  {
    name: 'a Windows executable with different casing',
    process: { ...claude, ExecutablePath: 'C:\\CLAUDE.EXE' },
    expected: true
  }
])('checks executable identity for $name', ({ process, expected }) => {
  execFileSync.mockReturnValue(JSON.stringify([electron, terminal, process]))

  expect(
    observeOwnedProcess(record, 'claude', true, new Set(), {
      name: 'claude.exe',
      shimPath: 'C:/isolated profile/shims/claude.exe'
    }).passed
  ).toBe(expected)
})

it('requires a new native process and keeps existing native processes visible to stop checks', () => {
  execFileSync.mockReturnValue(JSON.stringify([electron, terminal, claude]))
  const baseline = new Set(listOwnedProcessIds(record))

  expect(
    observeOwnedProcess(record, 'claude', true, baseline, {
      name: 'claude.exe',
      shimPath: 'C:/isolated profile/shims/claude.exe'
    })
  ).toEqual({ matched: [], passed: false })
  expect(
    observeOwnedProcess(record, 'claude', false, baseline, {
      name: 'claude.exe',
      shimPath: 'C:/isolated profile/shims/claude.exe'
    })
  ).toEqual({
    matched: [{ pid: 102, command: claude.CommandLine }],
    passed: false
  })
})

it('preserves command matching and ancestry checks for macOS processes', () => {
  execFileSync.mockReturnValue(
    '100 1 electron\n101 100 /bin/zsh -c claude\n102 101 /opt/bin/claude\n103 1 /opt/bin/claude\n'
  )

  expect(observeOwnedProcess({ ...record, platform: 'macos' }, 'claude', true, new Set([101]))).toEqual({
    matched: [{ pid: 102, command: '/opt/bin/claude' }],
    passed: true
  })
})
