import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationResourceView } from '../ConversationResourceView'

const { resourceCatalogViewMock } = vi.hoisted(() => ({
  resourceCatalogViewMock: vi.fn()
}))

vi.mock('@renderer/components/resource/catalog', () => ({
  ResourceCatalogView: (props: {
    allowedResourceTypes: readonly string[]
    assistantCatalogEnabled: boolean
    className?: string
    defaultResourceType: string
    showSidebar: boolean
  }) => {
    resourceCatalogViewMock(props)

    return (
      <div
        className={props.className}
        data-assistant-catalog-enabled={String(props.assistantCatalogEnabled)}
        data-default-resource-type={props.defaultResourceType}
        data-show-sidebar={String(props.showSidebar)}
        data-testid="resource-catalog-view"
      />
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
    expect(view).toHaveAttribute('data-default-resource-type', 'agent')
    expect(view).toHaveAttribute('data-show-sidebar', 'false')
    expect(view).toHaveAttribute('data-assistant-catalog-enabled', 'false')
    expect(view).toHaveClass('bg-background', 'custom-shell')
    expect(resourceCatalogViewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedResourceTypes: ['agent'],
        defaultResourceType: 'agent'
      })
    )
  })

  it('updates the allowed catalog type when the conversation resource kind changes', () => {
    const { rerender } = render(<ConversationResourceView kind="assistant" />)

    rerender(<ConversationResourceView kind="skill" />)

    expect(resourceCatalogViewMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        allowedResourceTypes: ['skill'],
        defaultResourceType: 'skill'
      })
    )
  })
})
