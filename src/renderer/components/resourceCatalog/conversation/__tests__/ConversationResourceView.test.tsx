import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationResourceView } from '../ConversationResourceView'

const { resourceCatalogViewMock } = vi.hoisted(() => ({
  resourceCatalogViewMock: vi.fn()
}))

vi.mock('@renderer/components/resourceCatalog/catalog', () => ({
  ResourceCatalogView: (props: { className?: string; resourceType: string }) => {
    resourceCatalogViewMock(props)

    return (
      <div className={props.className} data-resource-type={props.resourceType} data-testid="resource-catalog-view" />
    )
  }
}))

describe('ConversationResourceView', () => {
  beforeEach(() => {
    resourceCatalogViewMock.mockClear()
  })

  it('embeds the resource catalog for the selected resource kind', () => {
    render(<ConversationResourceView kind="agent" className="custom-shell" />)

    const view = screen.getByTestId('resource-catalog-view')
    expect(view).toHaveAttribute('data-resource-type', 'agent')
    expect(view).toHaveClass('bg-background', 'custom-shell')
    expect(resourceCatalogViewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'agent'
      })
    )
  })

  it('updates the allowed catalog type when the conversation resource kind changes', () => {
    const { rerender } = render(<ConversationResourceView kind="assistant" />)

    rerender(<ConversationResourceView kind="skill" />)

    expect(resourceCatalogViewMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        resourceType: 'skill'
      })
    )
  })
})
