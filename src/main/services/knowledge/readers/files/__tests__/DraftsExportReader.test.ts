import { describe, expect, it } from 'vitest'

import { DraftsExportReader } from '../DraftsExportReader'

describe('DraftsExportReader', () => {
  it('parses draft export entries into documents', async () => {
    const reader = new DraftsExportReader()
    const fileContent = new TextEncoder().encode(
      JSON.stringify([
        {
          content: ' first draft ',
          tags: ['work'],
          created_at: '2026-04-01T00:00:00.000Z'
        },
        {
          content: '   '
        },
        {
          content: 'second draft',
          modified_at: '2026-04-02T00:00:00.000Z'
        }
      ])
    )

    const documents = await reader.loadDataAsContent(fileContent)

    expect(documents).toHaveLength(2)
    expect(documents[0]).toMatchObject({
      text: 'first draft',
      metadata: {
        draftIndex: 0,
        tags: ['work'],
        modifiedAt: '2026-04-01T00:00:00.000Z'
      }
    })
    expect(documents[1]).toMatchObject({
      text: 'second draft',
      metadata: {
        draftIndex: 1,
        tags: [],
        modifiedAt: '2026-04-02T00:00:00.000Z'
      }
    })
  })

  it('throws a readable error when the export JSON is invalid', async () => {
    const reader = new DraftsExportReader()
    const fileContent = new TextEncoder().encode('{invalid json')

    await expect(reader.loadDataAsContent(fileContent)).rejects.toThrow('Failed to parse Drafts export JSON')
  })
})
