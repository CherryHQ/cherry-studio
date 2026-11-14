import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type { Assistant } from '@shared/data/types/assistant'

import { AssistantProfilePane } from '../AssistantProfilePane'
import { recordEditDialogRequests, renderInRightPane, serveQueries } from './profilePaneTestUtils'

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
