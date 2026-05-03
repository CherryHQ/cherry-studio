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

const ctx = {} as never // ContentMatcher passes ctx through; this matcher ignores it.

describe('matchBashRule — `cmd:*` (any args)', () => {
  it("'git status:*' matches 'git status'", () => {
    expect(matchBashRule({ command: 'git status' }, 'git status:*', ctx)).toBe(true)
  })

  it("'git status:*' matches 'git status -uno'", () => {
    expect(matchBashRule({ command: 'git status -uno' }, 'git status:*', ctx)).toBe(true)
  })

  it("'git status:*' does NOT match 'git push'", () => {
    expect(matchBashRule({ command: 'git push' }, 'git status:*', ctx)).toBe(false)
  })

  it("'git status:*' does NOT match 'git statusx' (no false-prefix)", () => {
    expect(matchBashRule({ command: 'git statusx' }, 'git status:*', ctx)).toBe(false)
  })

  it("'rm:*' matches 'rm foo.txt'", () => {
    expect(matchBashRule({ command: 'rm foo.txt' }, 'rm:*', ctx)).toBe(true)
  })
})

describe('matchBashRule — `cmd:exact` (exact args)', () => {
  it("'git push:origin main' matches 'git push origin main'", () => {
    expect(matchBashRule({ command: 'git push origin main' }, 'git push:origin main', ctx)).toBe(true)
  })

  it("'git push:origin main' does NOT match 'git push origin main --force'", () => {
    expect(matchBashRule({ command: 'git push origin main --force' }, 'git push:origin main', ctx)).toBe(false)
  })

  it("'git push:origin main' does NOT match 'git push'", () => {
    expect(matchBashRule({ command: 'git push' }, 'git push:origin main', ctx)).toBe(false)
  })
})

describe('matchBashRule — `cmd:prefix*` (prefix wildcard)', () => {
  it("'npm install:foo*' matches 'npm install foo' and 'npm install foobar'", () => {
    expect(matchBashRule({ command: 'npm install foo' }, 'npm install:foo*', ctx)).toBe(true)
    expect(matchBashRule({ command: 'npm install foobar' }, 'npm install:foo*', ctx)).toBe(true)
  })

  it("'npm install:foo*' does NOT match 'npm install bar'", () => {
    expect(matchBashRule({ command: 'npm install bar' }, 'npm install:foo*', ctx)).toBe(false)
  })
})

describe('matchBashRule — bare `cmd` (no colon, exact match)', () => {
  it("'pwd' matches 'pwd' exactly", () => {
    expect(matchBashRule({ command: 'pwd' }, 'pwd', ctx)).toBe(true)
  })

  it("'pwd' does NOT match 'pwd /foo'", () => {
    expect(matchBashRule({ command: 'pwd /foo' }, 'pwd', ctx)).toBe(false)
  })
})

describe('matchBashRule — multi-command literals', () => {
  it("'ls && cat README.md' matches the exact pipeline", () => {
    expect(matchBashRule({ command: 'ls && cat README.md' }, 'ls && cat README.md', ctx)).toBe(true)
  })

  it('whitespace differences are tolerated (collapse multiple spaces)', () => {
    expect(matchBashRule({ command: 'ls  &&  cat README.md' }, 'ls && cat README.md', ctx)).toBe(true)
  })
})

describe('matchBashRule — input shape', () => {
  it('input without a string `command` field returns false (defensive)', () => {
    expect(matchBashRule({}, 'ls:*', ctx)).toBe(false)
    expect(matchBashRule(null, 'ls:*', ctx)).toBe(false)
    expect(matchBashRule({ command: 42 }, 'ls:*', ctx)).toBe(false)
  })
})
