import { TerminalApp } from '@shared/types/codeCli'
import { describe, expect, it } from 'vitest'

import { escapeForAppleScript, MACOS_TERMINALS_WITH_COMMANDS, WINDOWS_TERMINALS_WITH_COMMANDS } from '../terminals'

function commandFor(id: TerminalApp) {
  const cfg = MACOS_TERMINALS_WITH_COMMANDS.find((t) => t.id === id)
  if (!cfg) throw new Error(`no terminal builder for ${id}`)
  return cfg.command
}

describe('escapeForAppleScript', () => {
  it('escapes backslashes and double quotes for the AppleScript string literal', () => {
    expect(escapeForAppleScript('a\\b')).toBe('a\\\\b')
    expect(escapeForAppleScript('say "hi"')).toBe('say \\"hi\\"')
  })

  // The literal is embedded in an `osascript -e '…'` argument, so a single quote must be rewritten to
  // '\'' — otherwise it would close the -e quote early and hand the remainder to the outer `sh -c`.
  it("rewrites single quotes to the sh-safe '\\'' form", () => {
    expect(escapeForAppleScript("it's")).toBe("it'\\''s")
    expect(escapeForAppleScript("' $(reboot)")).toBe("'\\'' $(reboot)")
  })
})

// AppleScript adapters (Terminal / iTerm2) route fullCommand through escapeForAppleScript, so
// a single quote in the command lands as the escaped form and cannot break out of the -e '…' quote.
describe('macOS AppleScript terminal builders neutralize single quotes in fullCommand', () => {
  it.each([TerminalApp.SYSTEM_DEFAULT, TerminalApp.ITERM2])('for %s', (id) => {
    const { args } = commandFor(id)('/tmp/project', "echo 'x' && $(reboot)")
    const script = args.join('\n')
    expect(script).toContain("'\\''") // the raw ' was rewritten to '\''
  })
})

it('launches Tabby through its command runner without touching the clipboard', () => {
  const fullCommand = "cd '/tmp/project' && run"
  const launch = commandFor(TerminalApp.TABBY)('/tmp/project', fullCommand)
  const serialized = [launch.command, ...launch.args].join(' ')

  expect(launch).toEqual({
    command: 'open',
    args: ['-na', 'Tabby', '--args', 'run', 'sh', '-c', fullCommand]
  })
  expect(serialized).not.toContain('clipboard')
  expect(serialized).not.toContain('keystroke')
  expect(serialized).not.toContain('osascript')
})

// `wt` must stay on the bare `--` passthrough: subcommands and flags such as `--inheritEnvironment`
// only parse on Windows Terminal >= 1.18, and older builds abort without ever opening a window.
it('launches Windows Terminal through the version-portable -- passthrough', () => {
  const cfg = WINDOWS_TERMINALS_WITH_COMMANDS.find((terminal) => terminal.id === TerminalApp.WINDOWS_TERMINAL)
  if (!cfg) throw new Error('no Windows Terminal builder')

  expect(cfg.command('C:\\project', 'C:\\launch.bat')).toEqual({
    command: 'wt',
    args: ['--', 'cmd', '/c', 'C:\\launch.bat']
  })
})

it('quotes Windows launch scripts before crossing the WSL shell boundary', () => {
  const cfg = WINDOWS_TERMINALS_WITH_COMMANDS.find((terminal) => terminal.id === TerminalApp.WSL)
  if (!cfg) throw new Error('no WSL terminal builder')

  expect(cfg.command('C:\\project', "C:\\Users\\O'Brien\\launch.bat")).toEqual({
    command: 'wsl',
    args: ['bash', '-c', "cmd.exe /c 'C:\\Users\\O'\\''Brien\\launch.bat' ; read -p 'Press Enter to exit'"]
  })
})

// Inner-double-quote adapters interpolate the raw directory AND embed fullCommand in `sh -c "…"`,
// where $ / backticks still expand — the directory is single-quoted and fullCommand is $/`-escaped.
describe('macOS inner-double-quote terminal builders neutralize directory and fullCommand', () => {
  it.each([TerminalApp.KITTY, TerminalApp.ALACRITTY, TerminalApp.WEZTERM, TerminalApp.GHOSTTY])('for %s', (id) => {
    const { args } = commandFor(id)('/tmp/$(calc)', 'run $HOME `id`')
    const script = args.join('\n')
    // directory single-quoted → $(calc) is inert data, never a substitution
    expect(script).toContain("'/tmp/$(calc)'")
    expect(script).not.toContain('"/tmp/$(calc)"')
    // fullCommand's $ and backticks escaped inside the inner double quotes
    expect(script).toContain('\\$HOME')
    expect(script).toContain('\\`id\\`')
  })

  // A directory with a literal single quote exercises the posixQuote '\'' escape at the same time as
  // the surrounding shell layers — the most likely spot for a layering bug.
  it.each([TerminalApp.KITTY, TerminalApp.ALACRITTY, TerminalApp.WEZTERM, TerminalApp.GHOSTTY])(
    'escapes a literal single quote in the directory via posixQuote for %s',
    (id) => {
      const { args } = commandFor(id)("/tmp/o'brien", 'run')
      expect(args.join('\n')).toContain("'/tmp/o'\\''brien'")
    }
  )
})
