import { describe, expect, it } from 'vitest'

import { createBrowserToolEntries } from '../BrowserTools'

const entries = createBrowserToolEntries()

describe('assistant browser model contract', () => {
  it('preserves every screenshot tile and its text for the model', async () => {
    const screenshot = entries.find((entry) => entry.name === 'browser_screenshot')!
    const result = await screenshot.tool.toModelOutput!({
      toolCallId: 'capture',
      input: {},
      output: {
        content: [
          { type: 'text', text: 'Two page regions' },
          { type: 'image', data: 'first', mimeType: 'image/png' },
          { type: 'image', data: 'second', mimeType: 'image/jpeg' }
        ]
      }
    })
    expect(result).toEqual({
      type: 'content',
      value: [
        { type: 'text', text: 'Two page regions' },
        { type: 'image-data', data: 'first', mediaType: 'image/png' },
        { type: 'image-data', data: 'second', mediaType: 'image/jpeg' }
      ]
    })
  })

  it('does not expose control without a verified conversation grant or cross-tab tools', () => {
    const scope = { mcpToolIds: new Set<string>() }
    expect(entries.every((entry) => !entry.applies!(scope))).toBe(true)
    expect(entries.every((entry) => entry.applies!({ ...scope, browserEnabled: true }))).toBe(true)
    expect(entries.map((entry) => entry.name)).not.toContain('browser_close_tab')
    expect(entries.map((entry) => entry.name)).not.toContain('browser_switch_tab')
    expect(entries.map((entry) => entry.name)).not.toContain('browser_reset')
  })
})
