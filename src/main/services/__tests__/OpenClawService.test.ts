import { describe, expect, it } from 'vitest'

import { parseCurrentVersion, parseUpdateStatus } from '../utils/openClawParsers'

describe('parseCurrentVersion', () => {
  const cases = [
    { name: 'standard version output', input: 'OpenClaw 2026.3.9 (fe96034)', expected: '2026.3.9' },
    { name: 'version without commit hash', input: 'OpenClaw 2026.3.11', expected: '2026.3.11' },
    { name: 'lowercase prefix', input: 'openclaw 1.0.0 (abc1234)', expected: '1.0.0' },
    { name: 'semver format', input: 'OpenClaw 0.12.3 (deadbeef)', expected: '0.12.3' },
    { name: 'empty string', input: '', expected: null },
    { name: 'unrelated output', input: 'some random text', expected: null },
    { name: 'version with extra whitespace', input: '  OpenClaw  2026.3.9  ', expected: '2026.3.9' }
  ]

  it.each(cases)('$name: "$input"', ({ input, expected }) => {
    expect(parseCurrentVersion(input)).toBe(expected)
  })

  it('snapshot: all cases', () => {
    const results = Object.fromEntries(cases.map((c) => [c.name, parseCurrentVersion(c.input)]))
    expect(results).toMatchInlineSnapshot(`
      {
        "empty string": null,
        "lowercase prefix": "1.0.0",
        "semver format": "0.12.3",
        "standard version output": "2026.3.9",
        "unrelated output": null,
        "version with extra whitespace": "2026.3.9",
        "version without commit hash": "2026.3.11",
      }
    `)
  })
})

describe('parseUpdateStatus', () => {
  const cases = [
    {
      name: 'npm update available',
      input: 'Update available (npm 2026.3.11). Run: openclaw update',
      expected: '2026.3.11'
    },
    {
      name: 'pkg update available',
      input: 'Update available · pkg · npm update 2026.3.11',
      expected: '2026.3.11'
    },
    {
      name: 'update available with semver',
      input: 'Update available (npm 1.2.3). Run: openclaw update',
      expected: '1.2.3'
    },
    {
      name: 'full table output with update',
      input: [
        'OpenClaw update status',
        '┌──────────┬─────────────────────────────────┐',
        '│ Install  │ binary (~/.cherrystudio/bin)     │',
        '│ Channel  │ stable (default)                 │',
        '│ Update   │ available · pkg · npm update 2026.3.11 │',
        '└──────────┴─────────────────────────────────┘',
        '',
        'Update available (npm 2026.3.11). Run: openclaw update'
      ].join('\n'),
      expected: '2026.3.11'
    },
    { name: 'no update available', input: 'Already up to date', expected: null },
    { name: 'empty string', input: '', expected: null },
    { name: 'unrelated output', input: 'some random text', expected: null }
  ]

  it.each(cases)('$name', ({ input, expected }) => {
    expect(parseUpdateStatus(input)).toBe(expected)
  })

  it('snapshot: all cases', () => {
    const results = Object.fromEntries(cases.map((c) => [c.name, parseUpdateStatus(c.input)]))
    expect(results).toMatchInlineSnapshot(`
      {
        "empty string": null,
        "full table output with update": "2026.3.11",
        "no update available": null,
        "npm update available": "2026.3.11",
        "pkg update available": "2026.3.11",
        "unrelated output": null,
        "update available with semver": "1.2.3",
      }
    `)
  })
})
