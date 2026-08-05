import { describe, expect, it } from 'vitest'

import { tabRequestSchemas } from '../tab'

describe('tab IPC schemas', () => {
  it('preserves generic tab metadata when parsing a detach request', () => {
    const parsed = tabRequestSchemas['tab.detach'].input.parse({
      id: 'tab-1',
      url: '/app/file-preview?path=file.txt',
      metadata: { filePreviewRefreshKey: 2 },
      savedState: { scrollPosition: 100 }
    })

    expect(parsed).toEqual({
      id: 'tab-1',
      url: '/app/file-preview?path=file.txt',
      metadata: { filePreviewRefreshKey: 2 }
    })
  })
})
