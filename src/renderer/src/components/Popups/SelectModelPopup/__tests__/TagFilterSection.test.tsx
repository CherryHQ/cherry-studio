import type { ModelTag } from '@renderer/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TagFilterSection from '../TagFilterSection'

const mocks = vi.hoisted(() => ({
  t: vi.fn((key: string) => key),
  createTagComponent: (name: string) => {
    // Create a simple button component exposing props for assertions
    return ({ onClick, inactive, showLabel }: { onClick?: () => void; inactive?: boolean; showLabel?: boolean }) => {
      const React = require('react')
      return React.createElement(
        'button',
        {
          type: 'button',
          'aria-label': `tag-${name}`,
          'data-inactive': String(Boolean(inactive)),
          onClick
        },
        showLabel ? name : ''
      )
    }
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t })
}))

vi.mock('@renderer/components/Tags/Model', () => ({
  VisionTag: mocks.createTagComponent('vision'),
  EmbeddingTag: mocks.createTagComponent('embedding'),
  ReasoningTag: mocks.createTagComponent('reasoning'),
  ToolsCallingTag: mocks.createTagComponent('function_calling'),
  WebSearchTag: mocks.createTagComponent('web_search'),
  RerankerTag: mocks.createTagComponent('rerank'),
  FreeTag: mocks.createTagComponent('free')
}))

vi.mock('antd', () => ({
  Flex: ({ children }: { children: React.ReactNode }) => children
}))

function createSelection(overrides: Partial<Record<ModelTag, boolean>> = {}): Record<ModelTag, boolean> {
  const base: Record<ModelTag, boolean> = {
    vision: true,
    embedding: true,
    reasoning: true,
    function_calling: true,
    web_search: true,
    rerank: true,
    free: true
  }
  return { ...base, ...overrides }
}

const allTags: ModelTag[] = ['vision', 'embedding', 'reasoning', 'function_calling', 'web_search', 'rerank', 'free']

describe('TagFilterSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should match snapshot', () => {
      const { container } = render(
        <TagFilterSection availableTags={allTags} tagSelection={createSelection()} onToggleTag={vi.fn()} />
      )
      expect(container).toMatchSnapshot()
    })

    it('should reflect inactive state based on tagSelection', () => {
      render(
        <TagFilterSection
          availableTags={['vision']}
          tagSelection={createSelection({ vision: false })}
          onToggleTag={vi.fn()}
        />
      )
      const visionBtn = screen.getByRole('button', { name: 'tag-vision' })
      expect(visionBtn).toHaveAttribute('data-inactive', 'true')
    })

    it('should skip unknown tags', () => {
      render(
        <TagFilterSection
          availableTags={['unknown' as unknown as ModelTag, 'vision']}
          tagSelection={createSelection()}
          onToggleTag={vi.fn()}
        />
      )
      expect(screen.queryByRole('button', { name: 'tag-unknown' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'tag-vision' })).toBeInTheDocument()
    })
  })

  describe('functionality', () => {
    it('should call onToggleTag when a tag is clicked', () => {
      const handleToggle = vi.fn()
      render(<TagFilterSection availableTags={allTags} tagSelection={createSelection()} onToggleTag={handleToggle} />)

      const visionBtn = screen.getByRole('button', { name: 'tag-vision' })
      fireEvent.click(visionBtn)

      expect(handleToggle).toHaveBeenCalledTimes(1)
      expect(handleToggle).toHaveBeenCalledWith('vision')
    })
  })
})
