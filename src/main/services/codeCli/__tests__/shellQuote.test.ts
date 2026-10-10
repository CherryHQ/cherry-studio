import { describe, expect, it } from 'vitest'

import { escapeForDoubleQuotes, isShellSafeModelId, posixQuote } from '../shellQuote'

describe('posixQuote', () => {
  it('wraps a plain value in single quotes', () => {
    expect(posixQuote('claude-sonnet-4-5')).toBe("'claude-sonnet-4-5'")
  })

  // The reviewer's injection payloads: inside single quotes none of these are interpreted by the shell.
  it('neutralizes spaces, $(), backticks and ; by quoting them literally', () => {
    expect(posixQuote('/tmp/my project')).toBe("'/tmp/my project'")
    expect(posixQuote('/tmp/$(rm -rf ~)')).toBe("'/tmp/$(rm -rf ~)'")
    expect(posixQuote('`whoami`')).toBe("'`whoami`'")
    expect(posixQuote('a; reboot')).toBe("'a; reboot'")
  })

  it("escapes an embedded single quote via the '\\'' idiom", () => {
    expect(posixQuote("it's")).toBe("'it'\\''s'")
    expect(posixQuote("a'b'c")).toBe("'a'\\''b'\\''c'")
  })

  it('always yields a token opened and closed by a single quote', () => {
    for (const v of ['', "x'", "'", "a'$(x)'b"]) {
      const out = posixQuote(v)
      expect(out.startsWith("'")).toBe(true)
      expect(out.endsWith("'")).toBe(true)
    }
  })
})

describe('escapeForDoubleQuotes', () => {
  it('escapes the metacharacters still live inside double quotes', () => {
    expect(escapeForDoubleQuotes('a\\b')).toBe('a\\\\b')
    expect(escapeForDoubleQuotes('a"b')).toBe('a\\"b')
    expect(escapeForDoubleQuotes('$(x)')).toBe('\\$(x)')
    expect(escapeForDoubleQuotes('`id`')).toBe('\\`id\\`')
  })

  it('escapes backslashes before the metacharacters it introduces', () => {
    // input: backslash + dollar → 3 backslashes + dollar (the \$ is not mistaken for a pre-escaped $)
    expect(escapeForDoubleQuotes('\\$')).toBe('\\\\\\$')
  })
})

describe('isShellSafeModelId', () => {
  it('accepts real model ids', () => {
    for (const m of [
      'gpt-4o',
      'claude-3-5-sonnet-20241022',
      'deepseek-ai/DeepSeek-V3',
      'qwen2.5:7b',
      'model@latest',
      'a_b.c'
    ]) {
      expect(isShellSafeModelId(m)).toBe(true)
    }
  })

  it('rejects ids carrying shell metacharacters or whitespace', () => {
    for (const m of ['gpt; rm -rf ~', 'm $(calc)', 'm`whoami`', "m'x", 'm"x', 'a b', 'm|x', 'm&x', 'm>x', '']) {
      expect(isShellSafeModelId(m)).toBe(false)
    }
  })
})
