/**
 * Tests for wrapper-stripping.
 *
 * Wrappers are commands that take another command as an argument:
 *   nice -n 10 ls
 *   env FOO=bar baz arg1
 *   timeout 30s curl example.com
 *   time make build
 *
 * The classifier strips them so the *real* command (and its real args)
 * gets allowlist/denylist treatment. If after stripping nothing remains,
 * we return null — the classifier should treat that as fail-closed.
 */

import { describe, expect, it } from 'vitest'

import type { SimpleCommand } from '../parser'
import { stripWrappers } from '../wrappers'

const cmd = (name: string, ...args: string[]): SimpleCommand => ({ name, args, start: 0, end: 0 })

describe('stripWrappers — single wrapper', () => {
  it("'nice -n 10 ls' → ls", () => {
    const out = stripWrappers(cmd('nice', '-n', '10', 'ls'))
    expect(out).toMatchObject({ name: 'ls', args: [] })
  })

  it("'timeout 30 curl https://example.com' → curl https://example.com", () => {
    const out = stripWrappers(cmd('timeout', '30', 'curl', 'https://example.com'))
    expect(out).toMatchObject({ name: 'curl', args: ['https://example.com'] })
  })

  it("'time make build' → make build", () => {
    const out = stripWrappers(cmd('time', 'make', 'build'))
    expect(out).toMatchObject({ name: 'make', args: ['build'] })
  })

  it("'env FOO=bar baz qux' → baz qux", () => {
    // env's flag args (FOO=bar) are skipped along with the wrapper itself.
    const out = stripWrappers(cmd('env', 'FOO=bar', 'baz', 'qux'))
    expect(out).toMatchObject({ name: 'baz', args: ['qux'] })
  })
})

describe('stripWrappers — nested wrappers', () => {
  it("'nice -n 10 timeout 30 ls' → ls (peels both)", () => {
    const out = stripWrappers(cmd('nice', '-n', '10', 'timeout', '30', 'ls'))
    expect(out).toMatchObject({ name: 'ls', args: [] })
  })
})

describe('stripWrappers — non-wrappers passed through', () => {
  it("'ls -la' is unchanged (not a wrapper)", () => {
    const out = stripWrappers(cmd('ls', '-la'))
    expect(out).toEqual(cmd('ls', '-la'))
  })

  it("'git status' is unchanged", () => {
    const out = stripWrappers(cmd('git', 'status'))
    expect(out).toEqual(cmd('git', 'status'))
  })
})

describe('stripWrappers — degenerate input', () => {
  it("'nice' (no payload) → null", () => {
    expect(stripWrappers(cmd('nice'))).toBeNull()
  })

  it("'nice -n 10' (only wrapper flags) → null", () => {
    expect(stripWrappers(cmd('nice', '-n', '10'))).toBeNull()
  })
})
