/**
 * Tests for the bash denylist.
 *
 * Denylist takes a *post-wrapper-stripped* SimpleCommand and decides
 * whether it should be denied outright (regardless of any allowlist or
 * user rule). These are the patterns we never want to ship to a real
 * shell, period.
 */

import { describe, expect, it } from 'vitest'

import { isDenied } from '../denylist'
import type { SimpleCommand } from '../parser'

const cmd = (name: string, ...args: string[]): SimpleCommand => ({ name, args, start: 0, end: 0 })

describe('isDenied — interpreter wrappers', () => {
  it('eval is denied unconditionally', () => {
    expect(isDenied(cmd('eval', 'whoami'))).toBe(true)
    expect(isDenied(cmd('eval'))).toBe(true)
  })

  it('sudo / su / doas are denied', () => {
    expect(isDenied(cmd('sudo', 'rm', '-rf', '/'))).toBe(true)
    expect(isDenied(cmd('su', '-'))).toBe(true)
    expect(isDenied(cmd('doas', 'rm'))).toBe(true)
  })

  it('exec built-in is denied (replaces shell process)', () => {
    expect(isDenied(cmd('exec', 'bash'))).toBe(true)
  })
})

describe('isDenied — destructive filesystem', () => {
  it("'rm -rf /' is denied (root)", () => {
    expect(isDenied(cmd('rm', '-rf', '/'))).toBe(true)
  })

  it("'rm -rf /*' is denied (root glob)", () => {
    expect(isDenied(cmd('rm', '-rf', '/*'))).toBe(true)
  })

  it("'rm -rf ~' / '$HOME' are denied", () => {
    expect(isDenied(cmd('rm', '-rf', '~'))).toBe(true)
    expect(isDenied(cmd('rm', '-rf', '$HOME'))).toBe(true)
  })

  it('rm targeting system dirs (/etc, /usr, /bin, /var) is denied', () => {
    expect(isDenied(cmd('rm', '-rf', '/etc'))).toBe(true)
    expect(isDenied(cmd('rm', '-rf', '/usr/lib'))).toBe(true)
    expect(isDenied(cmd('rm', '-rf', '/bin'))).toBe(true)
    expect(isDenied(cmd('rm', '-rf', '/var/log'))).toBe(true)
  })

  it("ordinary 'rm foo.txt' is NOT denied (just not auto-allowed)", () => {
    expect(isDenied(cmd('rm', 'foo.txt'))).toBe(false)
    expect(isDenied(cmd('rm', '-rf', './build'))).toBe(false)
  })

  it('dd writing to a device is denied', () => {
    expect(isDenied(cmd('dd', 'if=/dev/zero', 'of=/dev/sda'))).toBe(true)
  })

  it('mkfs.* is denied', () => {
    expect(isDenied(cmd('mkfs.ext4', '/dev/sda1'))).toBe(true)
    expect(isDenied(cmd('mkfs', '/dev/sda1'))).toBe(true)
  })

  it('chmod -R 777 is denied on system paths', () => {
    expect(isDenied(cmd('chmod', '-R', '777', '/'))).toBe(true)
    expect(isDenied(cmd('chmod', '-R', '777', '/etc'))).toBe(true)
  })
})

describe('isDenied — fork bomb / shell hostage', () => {
  it(':(){ :|:& };: is denied (fork bomb)', () => {
    // The parser would emit this as a function definition; the bash command
    // node has name ':' — denylist catches the literal name.
    expect(isDenied(cmd(':'))).toBe(true)
  })
})

describe("isDenied — read-only commands aren't denied", () => {
  it('ls / cat / git status not in denylist', () => {
    expect(isDenied(cmd('ls', '-la'))).toBe(false)
    expect(isDenied(cmd('cat', 'README.md'))).toBe(false)
    expect(isDenied(cmd('git', 'status'))).toBe(false)
  })

  it('echo / printf / true not in denylist', () => {
    expect(isDenied(cmd('echo', 'hello'))).toBe(false)
    expect(isDenied(cmd('printf', '%s', 'hi'))).toBe(false)
    expect(isDenied(cmd('true'))).toBe(false)
  })
})
