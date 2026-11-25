import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { assistantTable } from '@data/db/schemas/assistant'
import { fileEntryTable } from '@data/db/schemas/file'
import { topicTable } from '@data/db/schemas/topic'
import { artifactService } from '@data/services/ArtifactService'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import { createGenerateImageToolEntry } from '../PaintingTool'

const IMAGE_ID = '019606a0-0000-7000-8000-000000000001'

describe('generate_image in an Assistant topic', () => {
  const dbh = setupTestDatabase()
  const generateImage = vi.fn()

  afterEach(() => MockApplicationUtils.resetServices())

  async function generateIn(topicId: string) {
    MockApplicationUtils.setService('AiService', { generateImage })
    generateImage.mockResolvedValue({ files: [{ id: IMAGE_ID, name: 'cover.png' }] })
    const tool = createGenerateImageToolEntry().buildTool!({
      mcpToolIds: new Set(),
      paintingModel: { uniqueModelId: 'openai::gpt-image-1', support: null }
    })
    const options: ToolExecutionOptions = {
      toolCallId: 'call-1',
      messages: [],
      experimental_context: { requestId: 'request-1', topicId }
    }
    return tool.execute!({ prompt: 'a cover' }, options)
  }

  function seed() {
    dbh.db
      .insert(assistantTable)
      .values({ id: 'writer', name: 'Writer', emoji: '🌟', settings: DEFAULT_ASSISTANT_SETTINGS, orderKey: 'a' })
      .run()
    dbh.db.insert(topicTable).values({ id: 'topic-1', name: 'Launch post', assistantId: 'writer', orderKey: 'a' }).run()
    dbh.db
      .insert(fileEntryTable)
      .values({ id: IMAGE_ID, origin: 'internal', name: 'cover', ext: 'png', size: 4096, createdAt: 1, updatedAt: 1 })
      .run()
  }

  it("adds the generated image to the Assistant's outputs", async () => {
    seed()

    const output = await generateIn('topic-1')

    expect(output).toEqual([{ id: IMAGE_ID, name: 'cover.png' }])
    expect(artifactService.list({ assistantId: 'writer' }).items).toEqual([
      expect.objectContaining({
        fileEntryId: IMAGE_ID,
        title: 'cover.png',
        kind: 'media',
        size: 4096,
        sourceName: 'Launch post'
      })
    ])
  })

  it('returns the image even when the topic is not stored', async () => {
    seed()

    await expect(generateIn('temporary-topic')).resolves.toEqual([{ id: IMAGE_ID, name: 'cover.png' }])
    expect(artifactService.list({ assistantId: 'writer' }).counts.all).toBe(0)
  })
})
