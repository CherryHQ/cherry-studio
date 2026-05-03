/**
 * RED tests for apply_patch parser.
 *
 * Spec: Codex envelope format
 *   *** Begin Patch
 *   *** Add File: <path>          (body: + lines)
 *   *** Update File: <path>       (body: @@ hunks of context/-/+)
 *   *** Delete File: <path>       (no body)
 *   *** End Patch
 *
 * Reference: https://developers.openai.com/api/docs/guides/tools-apply-patch
 *
 * IR shape under test:
 *   { ops: PatchOp[] }
 *   PatchOp = Add | Update | Delete
 *   Add    = { type: 'add', path, lines: string[] }
 *   Update = { type: 'update', path, hunks: Hunk[] }
 *   Delete = { type: 'delete', path }
 *   Hunk   = { anchor?: string, lines: HunkLine[] }
 *   HunkLine = { type: 'context' | 'remove' | 'add', text: string }
 */

import { describe, expect, it } from 'vitest'

import { parsePatch, type Patch } from '../parser'

function ok(input: string): Patch {
  const result = parsePatch(input)
  if (!result.ok) {
    throw new Error(`Expected parse success, got error: ${result.error}`)
  }
  return result.value
}

function err(input: string): string {
  const result = parsePatch(input)
  if (result.ok) {
    throw new Error(`Expected parse error, got: ${JSON.stringify(result.value)}`)
  }
  return result.error
}

describe('parsePatch — envelope', () => {
  it('rejects input without Begin Patch marker', () => {
    expect(err('hello\n*** End Patch')).toMatch(/Begin Patch/)
  })

  it('rejects input without End Patch marker', () => {
    expect(err('*** Begin Patch\n*** Update File: x\n@@\n a\n')).toMatch(/End Patch/)
  })

  it('rejects content before Begin Patch', () => {
    expect(err('garbage\n*** Begin Patch\n*** End Patch')).toMatch(/before/i)
  })

  it('rejects content after End Patch', () => {
    expect(err('*** Begin Patch\n*** End Patch\ngarbage')).toMatch(/after/i)
  })

  it('parses empty patch (Begin / End only)', () => {
    expect(ok('*** Begin Patch\n*** End Patch')).toEqual({ ops: [] })
  })

  it('tolerates trailing newline after End Patch', () => {
    expect(ok('*** Begin Patch\n*** End Patch\n')).toEqual({ ops: [] })
  })
})

describe('parsePatch — Add File', () => {
  it('parses single Add with content lines', () => {
    const patch = ok(['*** Begin Patch', '*** Add File: hello.txt', '+Hello', '+World', '*** End Patch'].join('\n'))
    expect(patch.ops).toEqual([{ type: 'add', path: 'hello.txt', lines: ['Hello', 'World'] }])
  })

  it('allows empty Add (zero-byte new file)', () => {
    const patch = ok(['*** Begin Patch', '*** Add File: empty.txt', '*** End Patch'].join('\n'))
    expect(patch.ops).toEqual([{ type: 'add', path: 'empty.txt', lines: [] }])
  })

  it('preserves leading whitespace inside +content', () => {
    const patch = ok(
      ['*** Begin Patch', '*** Add File: x.py', '+def f():', '+    return 1', '*** End Patch'].join('\n')
    )
    const op = patch.ops[0]
    expect(op.type).toBe('add')
    if (op.type === 'add') expect(op.lines).toEqual(['def f():', '    return 1'])
  })

  it('rejects body line without + prefix inside Add', () => {
    expect(err(['*** Begin Patch', '*** Add File: x', '+ok', 'no-prefix', '*** End Patch'].join('\n'))).toMatch(
      /Add File body/i
    )
  })
})

describe('parsePatch — Delete File', () => {
  it('parses single Delete', () => {
    const patch = ok(['*** Begin Patch', '*** Delete File: old.txt', '*** End Patch'].join('\n'))
    expect(patch.ops).toEqual([{ type: 'delete', path: 'old.txt' }])
  })

  it('rejects Delete with body content', () => {
    expect(err(['*** Begin Patch', '*** Delete File: x', '+stray', '*** End Patch'].join('\n'))).toMatch(/Delete File/i)
  })
})

describe('parsePatch — Update File', () => {
  it('parses single hunk with no anchor', () => {
    const patch = ok(
      ['*** Begin Patch', '*** Update File: src/x.ts', '@@', ' before', '-old', '+new', ' after', '*** End Patch'].join(
        '\n'
      )
    )
    const op = patch.ops[0]
    expect(op.type).toBe('update')
    if (op.type === 'update') {
      expect(op.path).toBe('src/x.ts')
      expect(op.hunks).toHaveLength(1)
      expect(op.hunks[0]).toEqual({
        anchor: undefined,
        lines: [
          { type: 'context', text: 'before' },
          { type: 'remove', text: 'old' },
          { type: 'add', text: 'new' },
          { type: 'context', text: 'after' }
        ]
      })
    }
  })

  it('captures @@ anchor text', () => {
    const patch = ok(
      ['*** Begin Patch', '*** Update File: x', '@@ def greet():', ' x', '-y', '+z', '*** End Patch'].join('\n')
    )
    const op = patch.ops[0]
    if (op.type === 'update') expect(op.hunks[0].anchor).toBe('def greet():')
  })

  it('parses multiple hunks per file', () => {
    const patch = ok(
      [
        '*** Begin Patch',
        '*** Update File: x',
        '@@ first',
        ' a',
        '-b',
        '+B',
        '@@ second',
        ' c',
        '-d',
        '+D',
        '*** End Patch'
      ].join('\n')
    )
    const op = patch.ops[0]
    if (op.type === 'update') {
      expect(op.hunks).toHaveLength(2)
      expect(op.hunks[0].anchor).toBe('first')
      expect(op.hunks[1].anchor).toBe('second')
    }
  })

  it('rejects Update File with no hunks', () => {
    expect(err(['*** Begin Patch', '*** Update File: x', '*** End Patch'].join('\n'))).toMatch(/at least one hunk/i)
  })

  it('rejects body line that is neither context (space) nor +/-', () => {
    expect(err(['*** Begin Patch', '*** Update File: x', '@@', 'invalid-prefix', '*** End Patch'].join('\n'))).toMatch(
      /hunk line/i
    )
  })

  it('preserves trailing whitespace inside context / + / - lines', () => {
    const patch = ok(
      ['*** Begin Patch', '*** Update File: x', '@@', ' a   ', '-b\t', '+c ', '*** End Patch'].join('\n')
    )
    const op = patch.ops[0]
    if (op.type === 'update') {
      expect(op.hunks[0].lines).toEqual([
        { type: 'context', text: 'a   ' },
        { type: 'remove', text: 'b\t' },
        { type: 'add', text: 'c ' }
      ])
    }
  })
})

describe('parsePatch — multi-file', () => {
  it('parses Add + Update + Delete in one envelope, preserving order', () => {
    const patch = ok(
      [
        '*** Begin Patch',
        '*** Add File: new.txt',
        '+hello',
        '*** Update File: existing.ts',
        '@@',
        ' x',
        '-y',
        '+z',
        '*** Delete File: gone.md',
        '*** End Patch'
      ].join('\n')
    )
    expect(patch.ops.map((o) => ({ type: o.type, path: o.path }))).toEqual([
      { type: 'add', path: 'new.txt' },
      { type: 'update', path: 'existing.ts' },
      { type: 'delete', path: 'gone.md' }
    ])
  })
})

describe('parsePatch — paths', () => {
  it('trims whitespace around the path after the marker', () => {
    const patch = ok(['*** Begin Patch', '*** Add File:   spaced/path.txt  ', '+x', '*** End Patch'].join('\n'))
    expect(patch.ops[0].path).toBe('spaced/path.txt')
  })

  it('rejects empty path', () => {
    expect(err(['*** Begin Patch', '*** Add File:', '+x', '*** End Patch'].join('\n'))).toMatch(/path/i)
  })
})
