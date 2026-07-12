import { TerminalApp } from '@shared/types/codeCli'
import { describe, expect, it } from 'vitest'

import { escapeForAppleScript, MACOS_TERMINALS_WITH_COMMANDS } from '../terminals'

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
