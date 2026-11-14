import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { KNOWLEDGE_BASES_MAX_LIMIT } from '@shared/data/api/schemas/knowledges'
import type { Assistant } from '@shared/data/types/assistant'

import { AssistantProfilePane } from '../AssistantProfilePane'
import { recordEditDialogRequests, renderInRightPane, serveQueries } from './profilePaneTestUtils'

const knowledgeBase = (id: string, name: string, itemCount: number) => ({ id, name, itemCount })

const assistant = {
  id: 'assistant-1',
  name: 'Writing Assistant',
  emoji: '✍️',
  description: 'Turns scattered ideas into a clean draft',
  prompt: 'You are a writing assistant.',
  modelId: null,
  modelName: 'GPT-5.1',
  knowledgeBaseIds: [],
  mcpServerIds: [],
  settings: { enableBrowser: true }
} as unknown as Assistant

describe('AssistantProfilePane', () => {
  let dialog: ReturnType<typeof recordEditDialogRequests>

  beforeEach(async () => {
    MockUseDataApiUtils.resetMocks()
    await i18n.changeLanguage('en-US')
    serveQueries({ '/assistants/:id': ({ params }) => (params?.id === assistant.id ? assistant : undefined) })
    dialog = recordEditDialogRequests()
  })

  afterEach(() => dialog.stop())

  it('shows who the Assistant is', () => {
    renderInRightPane(<AssistantProfilePane assistantId={assistant.id} />)

    expect(screen.getByRole('heading', { name: 'Writing Assistant' })).toBeInTheDocument()
    expect(screen.getByText('Turns scattered ideas into a clean draft')).toBeInTheDocument()
  })

  it('lists only the knowledge bases linked to this Assistant, in its order, and manages them in the edit dialog', async () => {
    MockUseDataApiUtils.seedInfiniteQuery(
      '/knowledge-bases',
      [
        {
          items: [
            knowledgeBase('kb-brand', 'Brand guide', 12),
            knowledgeBase('kb-other', 'Another team wiki', 40),
            knowledgeBase('kb-style', 'Style rules', 1)
          ],
          nextCursor: undefined
        }
      ] as never,
      { query: { sortBy: 'orderKey', sortOrder: 'asc' }, limit: KNOWLEDGE_BASES_MAX_LIMIT }
    )
    serveQueries({
      '/assistants/:id': () => ({ ...assistant, knowledgeBaseIds: ['kb-style', 'kb-brand'] })
    })
    renderInRightPane(<AssistantProfilePane assistantId={assistant.id} />)
    const section = screen.getByRole('region', { name: 'Knowledge bases' })

    expect(
      within(section)
        .getAllByText(/Brand guide|Style rules|Another team wiki/)
        .map((node) => node.textContent)
    ).toEqual(['Style rules', 'Brand guide'])
    expect(within(section).getByText('12 docs')).toBeInTheDocument()

    fireEvent.click(within(section).getByRole('button', { name: 'Manage' }))
    await waitFor(() =>
      expect(dialog.requests).toEqual([{ kind: 'assistant', id: assistant.id, initialTab: 'tools.knowledge' }])
    )
  })

  it('leaves out the knowledge base section when none is linked', () => {
    renderInRightPane(<AssistantProfilePane assistantId={assistant.id} />)

    expect(screen.queryByRole('region', { name: 'Knowledge bases' })).toBeNull()
  })

  it('opens the edit dialog on the page of each settings entry', async () => {
    renderInRightPane(<AssistantProfilePane assistantId={assistant.id} />)
    const settings = screen.getByRole('region', { name: 'Settings' })

    fireEvent.click(within(settings).getByRole('button', { name: 'All' }))
    fireEvent.click(within(settings).getByRole('button', { name: 'Model: GPT-5.1' }))

    await waitFor(() =>
      expect(dialog.requests).toEqual([
        { kind: 'assistant', id: assistant.id, initialTab: undefined },
        { kind: 'assistant', id: assistant.id, initialTab: 'basic' }
      ])
    )
    expect(within(settings).getByRole('switch', { name: 'Browser' })).toBeChecked()
  })
})
