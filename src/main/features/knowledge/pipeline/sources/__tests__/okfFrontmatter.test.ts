import { describe, expect, it } from 'vitest'

import { serializeOkfFrontmatter, stripOkfFrontmatter } from '../okfFrontmatter'

describe('serializeOkfFrontmatter', () => {
  it('renders a flat OKF block with keys in priority order', () => {
    const block = serializeOkfFrontmatter({
      type: 'URL',
      title: 'Getting Started',
      resource: 'https://example.com/guide',
      timestamp: '2026-06-11T10:00:00.000Z'
    })

    expect(block).toBe(
      [
        '---',
        'type: "URL"',
        'title: "Getting Started"',
        'resource: "https://example.com/guide"',
        'timestamp: "2026-06-11T10:00:00.000Z"',
        '---',
        ''
      ].join('\n')
    )
  })

  it('omits absent optional fields', () => {
    const block = serializeOkfFrontmatter({
      type: 'Note',
      title: 'Meeting notes',
      timestamp: '2026-06-11T10:00:00.000Z'
    })

    expect(block).toBe(
      ['---', 'type: "Note"', 'title: "Meeting notes"', 'timestamp: "2026-06-11T10:00:00.000Z"', '---', ''].join('\n')
    )
    expect(block).not.toContain('resource')
  })
})

describe('stripOkfFrontmatter', () => {
  const roundTrips = (body: string, resource = 'https://example.com/p') => {
    const file =
      serializeOkfFrontmatter({ type: 'URL', title: 'T', resource, timestamp: '2026-06-11T00:00:00.000Z' }) + body
    expect(stripOkfFrontmatter(file)).toBe(body)
  }

  it('is the exact inverse of serialize for a plain body', () => {
    roundTrips('# Title\n\nbody text\n')
  })

  it('strips only our leading block, leaving a body that itself starts with frontmatter intact', () => {
    roundTrips('---\ntags: [a, b]\n---\n# Doc\n')
  })

  it('round-trips a body containing a horizontal-rule --- line', () => {
    roundTrips('above\n\n---\n\nbelow\n')
  })

  it('round-trips a resource URL containing --- and # characters', () => {
    roundTrips('body\n', 'https://example.com/a---b#frag')
  })

  it('round-trips when title/resource carry quotes, newlines, --- and # (JSON.stringify keeps each on one line)', () => {
    const body = '# Real heading\n\nactual body\n'
    const file =
      serializeOkfFrontmatter({
        type: 'URL',
        title: 'a "quoted" --- # title\nwith newline',
        resource: 'https://example.com/p?q="x"#frag',
        timestamp: '2026-06-11T00:00:00.000Z'
      }) + body
    expect(stripOkfFrontmatter(file)).toBe(body)
  })

  it('round-trips an empty body', () => {
    roundTrips('')
  })

  it('leaves text without a leading frontmatter block untouched', () => {
    expect(stripOkfFrontmatter('# Just markdown\n')).toBe('# Just markdown\n')
  })

  it('leaves an unterminated frontmatter block untouched', () => {
    const text = '---\ntype: "URL"\nno closing delimiter\n'
    expect(stripOkfFrontmatter(text)).toBe(text)
  })

  it('strips only the leading block, never a later one', () => {
    roundTrips('intro\n---\ntype: "Note"\n---\nrest\n')
  })
})
