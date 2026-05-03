/**
 * Tests for the bash AST parser. Pure parser: no classification — we
 * only assert the SimpleCommand[] shape + flags the classifier (5.5.3)
 * will consume.
 *
 * Failure-closed contract: if the input contains anything the parser
 * can't fully resolve (ERROR nodes, command substitution with unknown
 * children, etc.) we surface it as `hasUnknown: true` so the classifier
 * downstream refuses to allow.
 */

import './setupBashWasm'

import { describe, expect, it } from 'vitest'

import { parseBashCommand } from '../parser'

describe('parseBashCommand — single command', () => {
  it("'git status' → one command, name=git, args=['status']", async () => {
    const ast = await parseBashCommand('git status')
    expect(ast.commands).toHaveLength(1)
    expect(ast.commands[0]).toMatchObject({ name: 'git', args: ['status'] })
    expect(ast.hasCommandSubstitution).toBe(false)
    expect(ast.hasRedirection).toBe(false)
    expect(ast.hasUnknown).toBe(false)
  })

  it("'rm -rf /' → name=rm, args=['-rf', '/']", async () => {
    const ast = await parseBashCommand('rm -rf /')
    expect(ast.commands).toHaveLength(1)
    expect(ast.commands[0]).toMatchObject({ name: 'rm', args: ['-rf', '/'] })
  })

  it("'ls' (no args) → name=ls, args=[]", async () => {
    const ast = await parseBashCommand('ls')
    expect(ast.commands[0]).toMatchObject({ name: 'ls', args: [] })
  })

  it('\'echo "hello world"\' → quoted arg preserved as a single token', async () => {
    const ast = await parseBashCommand('echo "hello world"')
    expect(ast.commands).toHaveLength(1)
    expect(ast.commands[0].name).toBe('echo')
    expect(ast.commands[0].args).toHaveLength(1)
    // Quotes may or may not be stripped — implementation choice — but the
    // arg payload must contain "hello world".
    expect(ast.commands[0].args[0]).toContain('hello world')
  })

  it('preserves source ranges for the command', async () => {
    const ast = await parseBashCommand('  git status')
    expect(ast.commands[0].start).toBe(2)
    expect(ast.commands[0].end).toBe('  git status'.length)
  })
})

describe('parseBashCommand — connectors', () => {
  it("'ls && cat foo' → 2 commands in source order", async () => {
    const ast = await parseBashCommand('ls && cat foo')
    expect(ast.commands).toHaveLength(2)
    expect(ast.commands[0]).toMatchObject({ name: 'ls', args: [] })
    expect(ast.commands[1]).toMatchObject({ name: 'cat', args: ['foo'] })
  })

  it("'ls | grep foo' → both commands enumerated", async () => {
    const ast = await parseBashCommand('ls | grep foo')
    expect(ast.commands.map((c) => c.name)).toEqual(['ls', 'grep'])
  })

  it("'a; b; c' → 3 commands", async () => {
    const ast = await parseBashCommand('a; b; c')
    expect(ast.commands.map((c) => c.name)).toEqual(['a', 'b', 'c'])
  })

  it("'true || false' → 2 commands", async () => {
    const ast = await parseBashCommand('true || false')
    expect(ast.commands.map((c) => c.name)).toEqual(['true', 'false'])
  })
})

describe('parseBashCommand — command substitution', () => {
  it("'cat $(echo file.txt)' → flags hasCommandSubstitution", async () => {
    const ast = await parseBashCommand('cat $(echo file.txt)')
    expect(ast.hasCommandSubstitution).toBe(true)
    // Inner command must also be enumerated so classifier can deny on the
    // worst sub-command rather than rubber-stamp the outer one.
    const names = ast.commands.map((c) => c.name)
    expect(names).toContain('cat')
    expect(names).toContain('echo')
  })

  it("'echo `whoami`' (backtick) → flags hasCommandSubstitution", async () => {
    const ast = await parseBashCommand('echo `whoami`')
    expect(ast.hasCommandSubstitution).toBe(true)
  })
})

describe('parseBashCommand — redirection', () => {
  it("'cat foo > out.txt' → flags hasRedirection", async () => {
    const ast = await parseBashCommand('cat foo > out.txt')
    expect(ast.hasRedirection).toBe(true)
    expect(ast.commands[0]).toMatchObject({ name: 'cat', args: ['foo'] })
  })

  it("'cat < in.txt' → flags hasRedirection", async () => {
    const ast = await parseBashCommand('cat < in.txt')
    expect(ast.hasRedirection).toBe(true)
  })
})

describe('parseBashCommand — fail-closed on bad input', () => {
  it("empty string → hasUnknown=true (don't claim 'no commands = safe')", async () => {
    const ast = await parseBashCommand('')
    expect(ast.hasUnknown).toBe(true)
  })

  it('whitespace-only → hasUnknown=true', async () => {
    const ast = await parseBashCommand('   ')
    expect(ast.hasUnknown).toBe(true)
  })

  it("malformed input ('if [') → hasUnknown=true", async () => {
    const ast = await parseBashCommand('if [')
    expect(ast.hasUnknown).toBe(true)
  })
})

describe('parseBashCommand — wrapper-style commands (parser passes raw)', () => {
  // The parser's job is structural — wrapper stripping (`nice -n 10 ls` →
  // treat as `ls`) is the classifier's job. Parser must report the literal
  // command without "helpful" rewriting.
  it("'nice -n 10 ls' → single command name=nice (raw)", async () => {
    const ast = await parseBashCommand('nice -n 10 ls')
    expect(ast.commands).toHaveLength(1)
    expect(ast.commands[0].name).toBe('nice')
    expect(ast.commands[0].args).toEqual(['-n', '10', 'ls'])
  })
})

describe('parseBashCommand — caching', () => {
  it('parses many calls quickly without re-initializing', async () => {
    const start = Date.now()
    for (let i = 0; i < 50; i++) {
      await parseBashCommand('git status')
    }
    const elapsed = Date.now() - start
    // After cold start, 50 small parses should be well under 500ms.
    // Generous bound; tightens once measured on CI.
    expect(elapsed).toBeLessThan(500)
  })
})
