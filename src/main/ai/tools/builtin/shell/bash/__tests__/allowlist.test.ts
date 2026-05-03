/**
 * Tests for the bash allowlist.
 *
 * Allowlist takes a *post-wrapper-stripped* SimpleCommand and decides
 * whether it's safe to auto-approve. Only read-only / metadata commands
 * are eligible — when in doubt, return false (the central pipeline
 * downgrades unmatched-but-not-denied calls to 'ask', not 'allow').
 *
 * Subcommand awareness: `git status` is allowed, `git push` is not.
 */

import { describe, expect, it } from 'vitest'

import { isAllowed } from '../allowlist'
import type { SimpleCommand } from '../parser'

const cmd = (name: string, ...args: string[]): SimpleCommand => ({ name, args, start: 0, end: 0 })

describe('isAllowed — filesystem reads', () => {
  it('ls, cat, head, tail are allowed with any args', () => {
    expect(isAllowed(cmd('ls'))).toBe(true)
    expect(isAllowed(cmd('ls', '-la', 'src'))).toBe(true)
    expect(isAllowed(cmd('cat', 'README.md'))).toBe(true)
    expect(isAllowed(cmd('head', '-n', '20', 'foo'))).toBe(true)
    expect(isAllowed(cmd('tail', '-f', 'log.txt'))).toBe(true)
  })

  it('pwd / whoami / uname / hostname are allowed', () => {
    expect(isAllowed(cmd('pwd'))).toBe(true)
    expect(isAllowed(cmd('whoami'))).toBe(true)
    expect(isAllowed(cmd('uname', '-a'))).toBe(true)
    expect(isAllowed(cmd('hostname'))).toBe(true)
  })

  it('which / type / file are allowed', () => {
    expect(isAllowed(cmd('which', 'node'))).toBe(true)
    expect(isAllowed(cmd('type', 'cd'))).toBe(true)
    expect(isAllowed(cmd('file', 'binary'))).toBe(true)
  })

  it('echo / printf / true / false are allowed', () => {
    expect(isAllowed(cmd('echo', 'hi'))).toBe(true)
    expect(isAllowed(cmd('printf', '%s', 'hi'))).toBe(true)
    expect(isAllowed(cmd('true'))).toBe(true)
    expect(isAllowed(cmd('false'))).toBe(true)
  })
})

describe('isAllowed — find / grep need flag inspection', () => {
  it('find without -exec / -delete is allowed', () => {
    expect(isAllowed(cmd('find', '.', '-name', '*.ts'))).toBe(true)
    expect(isAllowed(cmd('find', '/tmp'))).toBe(true)
  })

  it('find -exec is NOT auto-allowed (escalation vector)', () => {
    expect(isAllowed(cmd('find', '.', '-exec', 'rm', '{}', ';'))).toBe(false)
  })

  it('find -delete is NOT auto-allowed', () => {
    expect(isAllowed(cmd('find', '.', '-name', '*.bak', '-delete'))).toBe(false)
  })

  it('grep / rg with any args are allowed', () => {
    expect(isAllowed(cmd('grep', '-r', 'foo', '.'))).toBe(true)
    expect(isAllowed(cmd('rg', 'pattern'))).toBe(true)
  })
})

describe('isAllowed — git read-only subcommands', () => {
  it('git status / log / diff / show / branch are allowed', () => {
    expect(isAllowed(cmd('git', 'status'))).toBe(true)
    expect(isAllowed(cmd('git', 'log', '--oneline'))).toBe(true)
    expect(isAllowed(cmd('git', 'diff'))).toBe(true)
    expect(isAllowed(cmd('git', 'show', 'HEAD'))).toBe(true)
    expect(isAllowed(cmd('git', 'branch'))).toBe(true)
  })

  it('git push / commit / reset / clean are NOT allowed', () => {
    expect(isAllowed(cmd('git', 'push'))).toBe(false)
    expect(isAllowed(cmd('git', 'commit', '-m', 'msg'))).toBe(false)
    expect(isAllowed(cmd('git', 'reset', '--hard'))).toBe(false)
    expect(isAllowed(cmd('git', 'clean', '-fd'))).toBe(false)
  })

  it('bare `git` (no subcommand) is NOT allowed', () => {
    expect(isAllowed(cmd('git'))).toBe(false)
  })
})

describe("isAllowed — write commands aren't allowed", () => {
  it('rm / mv / cp / mkdir / touch are not allowed', () => {
    expect(isAllowed(cmd('rm', 'foo'))).toBe(false)
    expect(isAllowed(cmd('mv', 'a', 'b'))).toBe(false)
    expect(isAllowed(cmd('cp', 'a', 'b'))).toBe(false)
    expect(isAllowed(cmd('mkdir', 'foo'))).toBe(false)
    expect(isAllowed(cmd('touch', 'foo'))).toBe(false)
  })

  it('npm install / pnpm add / yarn add are not allowed', () => {
    expect(isAllowed(cmd('npm', 'install', 'foo'))).toBe(false)
    expect(isAllowed(cmd('pnpm', 'add', 'foo'))).toBe(false)
    expect(isAllowed(cmd('yarn', 'add', 'foo'))).toBe(false)
  })
})

describe("isAllowed — unknown commands aren't allowed", () => {
  it('user binary is not allowed by default', () => {
    expect(isAllowed(cmd('./script.sh'))).toBe(false)
    expect(isAllowed(cmd('my-tool'))).toBe(false)
  })
})
