import { describe, expect, it } from 'vitest'

import { sanitizeSearchEntryPointHtml } from '../sanitizeHtml'

describe('sanitizeHtml', () => {
  it('keeps style tags for search entry point content while stripping active content', () => {
    const html = '<style>.chip{color:red}</style><div onclick="alert(1)">safe</div><script>alert(1)</script>'
    const sanitized = sanitizeSearchEntryPointHtml(html)

    expect(sanitized).toContain('<style>.chip{color:red}</style>')
    expect(sanitized).toContain('<div>safe</div>')
    expect(sanitized).not.toContain('onclick')
    expect(sanitized).not.toContain('<script')
  })
})
