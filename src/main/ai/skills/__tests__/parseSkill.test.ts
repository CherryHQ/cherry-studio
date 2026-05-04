import { describe, expect, it } from 'vitest'

import { parseSkill } from '../parseSkill'

const FRONTMATTER = `---
name: code-review
description: Review pull requests with focus on security and perf
allowed-tools:
  - shell__exec
  - fs__read
---`

describe('parseSkill', () => {
  /**
   * Schema mapping + body extraction. Crucially, body must NOT start
   * with the frontmatter delimiter — a regression that returns the raw
   * file content (without stripping) would still produce a non-null
   * Skill with a populated `contentHash`, so we explicitly assert the
   * body shape rather than just trusting a hash field exists.
   */
  it('parses a valid SKILL.md into a Skill with stripped body and computed contentHash', () => {
    const raw = `${FRONTMATTER}
# Code review

Read the diff. Look for security issues. Then run tests.
`
    const out = parseSkill({
      raw,
      path: '/abs/path/SKILL.md',
      source: 'cherry-global'
    })

    expect(out).not.toBeNull()
    if (out === null) return
    expect(out.name).toBe('code-review')
    expect(out.description).toBe('Review pull requests with focus on security and perf')
    expect(out.body.startsWith('---')).toBe(false)
    expect(out.body.startsWith('# Code review')).toBe(true)
    expect(out.body).toContain('Read the diff.')
    expect(typeof out.contentHash).toBe('string')
    expect(out.contentHash.length).toBeGreaterThan(0)
    expect(out.allowedTools).toEqual(['shell__exec', 'fs__read'])
    expect(out.source).toBe('cherry-global')
    expect(out.path).toBe('/abs/path/SKILL.md')
  })

  /**
   * Missing `name` is the only frontmatter validation we enforce —
   * everything else has sensible defaults. A skill without `name`
   * cannot be addressed by `skills__load` and would silently appear
   * in the catalog with an empty key.
   */
  it('returns null when frontmatter is missing the name field', () => {
    const raw = `---
description: Has description but no name
---
body text`
    const out = parseSkill({
      raw,
      path: '/abs/path/SKILL.md',
      source: 'cherry-global'
    })
    expect(out).toBeNull()
  })

  /**
   * CRLF in frontmatter is real: a SKILL.md authored on Windows or
   * synced through git with autocrlf=true will use \\r\\n line endings.
   * A naive parser that splits only on \\n keeps \\r in the values, so
   * \`name\` becomes \`"code-review\\r"\`. That breaks dedup-by-name
   * across operating systems silently.
   */
  it('strips \\r from CRLF-encoded frontmatter values', () => {
    const raw = `---\r\nname: code-review\r\ndescription: with crlf\r\n---\r\nBody line\r\n`
    const out = parseSkill({
      raw,
      path: '/abs/path/SKILL.md',
      source: 'cherry-global'
    })
    expect(out).not.toBeNull()
    if (out === null) return
    expect(out.name).toBe('code-review')
    expect(out.name).not.toContain('\r')
    expect(out.description).toBe('with crlf')
  })

  /**
   * Markdown horizontal rules in the body are common (`---` between
   * sections). A frontmatter splitter that greedily searches for the
   * second `---` from position 0 will truncate the body at the first
   * in-prose horizontal rule. Body must remain intact when it
   * contains `---` lines.
   */
  it('preserves --- horizontal rules in the body', () => {
    const raw = `${FRONTMATTER}
# Section A

Some prose.

---

# Section B

More prose.
`
    const out = parseSkill({
      raw,
      path: '/abs/path/SKILL.md',
      source: 'cherry-global'
    })
    expect(out).not.toBeNull()
    if (out === null) return
    expect(out.body).toContain('# Section A')
    expect(out.body).toContain('# Section B')
    expect(out.body).toContain('More prose.')
    // The horizontal rule between sections must survive
    expect(out.body.split('\n').filter((l) => l.trim() === '---').length).toBeGreaterThan(0)
  })
})
