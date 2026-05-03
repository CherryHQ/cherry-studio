/**
 * Tests for the bash content matcher.
 *
 * Registered as the per-tool ContentMatcher for `shell__exec`. Decides
 * whether `Bash(<ruleContent>)` covers a given `shell__exec` input.
 *
 * Sync by design (the central matcher pipeline is sync). Operates on
 * the raw `input.command` string — no re-parsing — because L3
 * (`classifier.ts`) has already done the structural work.
 */

import { describe, expect, it } from 'vitest'

import { matchBashRule } from '../ruleMatcher'

// Test-local helper: behavior is ignored by the bash matcher, so default
// to 'allow' to keep the call sites focused on input + rule.
const match = (input: unknown, rule: string): boolean => matchBashRule(input, rule, {} as never, 'allow')

describe('matchBashRule — `cmd:*` (any args)', () => {
  it("'git status:*' matches 'git status'", () => {
    expect(match({ command: 'git status' }, 'git status:*')).toBe(true)
  })

  it("'git status:*' matches 'git status -uno'", () => {
    expect(match({ command: 'git status -uno' }, 'git status:*')).toBe(true)
  })

  it("'git status:*' does NOT match 'git push'", () => {
    expect(match({ command: 'git push' }, 'git status:*')).toBe(false)
  })

  it("'git status:*' does NOT match 'git statusx' (no false-prefix)", () => {
    expect(match({ command: 'git statusx' }, 'git status:*')).toBe(false)
  })

  it("'rm:*' matches 'rm foo.txt'", () => {
    expect(match({ command: 'rm foo.txt' }, 'rm:*')).toBe(true)
  })
})

describe('matchBashRule — `cmd:exact` (exact args)', () => {
  it("'git push:origin main' matches 'git push origin main'", () => {
    expect(match({ command: 'git push origin main' }, 'git push:origin main')).toBe(true)
  })

  it("'git push:origin main' does NOT match 'git push origin main --force'", () => {
    expect(match({ command: 'git push origin main --force' }, 'git push:origin main')).toBe(false)
  })

  it("'git push:origin main' does NOT match 'git push'", () => {
    expect(match({ command: 'git push' }, 'git push:origin main')).toBe(false)
  })
})

describe('matchBashRule — `cmd:prefix*` (prefix wildcard)', () => {
  it("'npm install:foo*' matches 'npm install foo' and 'npm install foobar'", () => {
    expect(match({ command: 'npm install foo' }, 'npm install:foo*')).toBe(true)
    expect(match({ command: 'npm install foobar' }, 'npm install:foo*')).toBe(true)
  })

  it("'npm install:foo*' does NOT match 'npm install bar'", () => {
    expect(match({ command: 'npm install bar' }, 'npm install:foo*')).toBe(false)
  })
})

describe('matchBashRule — bare `cmd` (no colon, exact match)', () => {
  it("'pwd' matches 'pwd' exactly", () => {
    expect(match({ command: 'pwd' }, 'pwd')).toBe(true)
  })

  it("'pwd' does NOT match 'pwd /foo'", () => {
    expect(match({ command: 'pwd /foo' }, 'pwd')).toBe(false)
  })
})

describe('matchBashRule — multi-command literals', () => {
  it("'ls && cat README.md' matches the exact pipeline", () => {
    expect(match({ command: 'ls && cat README.md' }, 'ls && cat README.md')).toBe(true)
  })

  it('whitespace differences are tolerated (collapse multiple spaces)', () => {
    expect(match({ command: 'ls  &&  cat README.md' }, 'ls && cat README.md')).toBe(true)
  })
})

describe('matchBashRule — input shape', () => {
  it('input without a string `command` field returns false (defensive)', () => {
    expect(match({}, 'ls:*')).toBe(false)
    expect(match(null, 'ls:*')).toBe(false)
    expect(match({ command: 42 }, 'ls:*')).toBe(false)
  })
})
