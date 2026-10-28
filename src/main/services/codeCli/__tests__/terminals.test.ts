import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { TerminalApp } from '@shared/types/codeCli'

import { posixQuote } from '../shellQuote'
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

// AppleScript adapters (Terminal / iTerm2 / Tabby) route fullCommand through escapeForAppleScript, so
// a single quote in the command lands as the escaped form and cannot break out of the -e '…' quote.
describe('macOS AppleScript terminal builders neutralize single quotes in fullCommand', () => {
  it.each([TerminalApp.SYSTEM_DEFAULT, TerminalApp.ITERM2, TerminalApp.TABBY])('for %s', (id) => {
    const { args } = commandFor(id)('/tmp/project', "echo 'x' && $(reboot)")
    const script = args.join('\n')
    expect(script).toContain("'\\''") // the raw ' was rewritten to '\''
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

function windowsShellCommandLine(command: string, args: string[]) {
  return `"${[command, ...args].join(' ')}"`
}

// Only ordinary cmd /s stripping and whole-token double quotes are modeled; expansions are rejected.
function decodeWslCommandLine(commandLine: string) {
  if (!/^"[A-Za-z0-9 :\\/'"._;-]+"$/.test(commandLine)) {
    throw new Error('Unsupported cmd fixture: only literal paths, spaces and whole-token double quotes are supported')
  }
  const rest = commandLine.slice(1, -1)
  const tokens = rest.match(/"[^"]*"|[^ "]+/g) ?? []
  if (tokens.join(' ') !== rest || tokens[0] !== 'wsl') {
    throw new Error('Unsupported cmd fixture: expected wsl and space-separated, whole-token quotes')
  }
  return tokens.map((token) => posixQuote(token.startsWith('"') ? token.slice(1, -1) : token)).join(' ')
}

const WSL_HANDOFF_STAND_IN = String.raw`
function cmd.exe() {
  printf 'cmd\0%d\0' "$#"
  for arg in "$@"; do printf '%s\0' "$arg"; done
}
export -f cmd.exe
function wsl() {
  printf 'wsl\0%d\0' "$#"
  for arg in "$@"; do printf '%s\0' "$arg"; done
  if [ "$1" = '--exec' ]; then shift; "$@"; else /bin/bash -c "$*"; fi
}
`

describe('WSL launcher handoff through the retained Windows shell transport', () => {
  it.each([
    String.raw`C:\projects\demo\launch.bat`,
    String.raw`C:\Users\John Doe\AppData\Local\Temp\CherryStudio\cli\launch_kimi-code_1758.bat`,
    String.raw`C:\Users\O'Brien\AppData\Local\Temp\CherryStudio\cli\launch.bat`
  ])('preserves /c and the literal batch path %s', (batPath) => {
    const cfg = WINDOWS_TERMINALS_WITH_COMMANDS.find((terminal) => terminal.id === TerminalApp.WSL)!
    const { command, args } = cfg.command(String.raw`C:\projects\demo`, batPath)
    const decoded = decodeWslCommandLine(windowsShellCommandLine(command, args))
    const result = spawnSync('/bin/bash', ['-c', `${WSL_HANDOFF_STAND_IN}\n${decoded}`], {
      input: '',
      encoding: 'utf8'
    })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.stderr).toBe('')
    const fields = result.stdout.split('\0')
    const cmdIndex = fields.indexOf('cmd')
    expect(fields[cmdIndex + 1], 'cmd.exe argument count').toBe('2')
    expect(fields.slice(cmdIndex + 2, -1)).toEqual(['/c', batPath])
    expect(fields.slice(0, 5)).toEqual(['wsl', '4', '--exec', 'bash', '-c'])
    expect(cmdIndex, 'one program operand after bash -c').toBe(6)
  })

  it.each(['%', '!', '^', '&', '|', '<', '>', '$', '`', '(', ')', '\n', '\0', '"'])(
    'rejects unsupported cmd fixture syntax %j',
    (character) => {
      const line = windowsShellCommandLine('wsl', ['bash', '-c', `cmd.exe /c C:\\${character}\\launch.bat`])
      expect(() => decodeWslCommandLine(line)).toThrow('Unsupported cmd fixture')
    }
  )
})
