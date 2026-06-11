import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KnowledgeBaseButton from '../KnowledgeBaseButton'

const mockNavigate = vi.fn()
const mockUseQuickPanel = vi.fn()

vi.mock('@renderer/components/Buttons', () => ({
  ActionIconButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; icon: ReactNode }) => {
    const { icon, ...buttonProps } = props
    delete buttonProps.active

    return (
      <button type="button" {...buttonProps}>
        {icon}
      </button>
    )
  }
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelReservedSymbol: {
    KnowledgeBase: 'knowledge-base'
  },
  useQuickPanel: () => mockUseQuickPanel()
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate
}))

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'chat.input.knowledge_base': 'Knowledge Base',
          'files.count': 'files',
          'knowledge.add.title': 'Add knowledge base',
          'settings.input.clear.all': 'Clear all',
          'settings.input.clear.knowledge_base': 'Clear knowledge bases'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBaseListItem> = {}): KnowledgeBaseListItem => ({
  id: 'base-1',
  name: 'Docs',
  groupId: null,
  dimensions: 1536,
  embeddingModelId: 'openai::text-embedding-3-small',
  rerankModelId: undefined,
  fileProcessorId: undefined,
  chunkSize: 1024,
  chunkOverlap: 200,
  threshold: 0.1,
  documentCount: 6,
  status: 'completed',
  error: null,
  searchMode: 'vector',
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  itemCount: 3,
  ...overrides
})

const createQuickPanelApi = (): ToolQuickPanelApi => ({
  registerRootMenu: vi.fn(() => vi.fn()),
  registerTrigger: vi.fn(() => vi.fn())
})

describe('KnowledgeBaseButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuickPanel.mockReturnValue({
      open: vi.fn(),
      close: vi.fn(),
      isVisible: false,
      symbol: null
    })
  })

  it('shows the v2 item count in the quick panel list', () => {
    render(
      <KnowledgeBaseButton
        quickPanel={createQuickPanelApi()}
        bases={[createKnowledgeBase({ itemCount: 7 })]}
        selectedBases={[]}
        onSelect={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Knowledge Base' }))

    expect(mockUseQuickPanel().open).toHaveBeenCalledWith(
      expect.objectContaining({
        list: expect.arrayContaining([
          expect.objectContaining({
            label: 'Docs',
            description: '7 files'
          })
        ])
      })
    )
  })
})
