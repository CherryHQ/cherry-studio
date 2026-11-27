import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ScrollArea } from '@cherrystudio/ui'

import { LocalAgentModelSelector } from '../../LocalAgentModelSelector'
import { LocalAgentModelList } from '../LocalAgentModelList'

vi.unmock('@cherrystudio/ui')

function TestModelList(props: Omit<ComponentProps<typeof LocalAgentModelList>, 'scrollElement'>) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  return (
    <ScrollArea viewportProps={{ ref: setScrollElement, 'aria-label': 'Model settings', role: 'region' }}>
      <LocalAgentModelList {...props} scrollElement={scrollElement} />
    </ScrollArea>
  )
}

describe('local agent model search', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-index') ? 42 : 320
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('mounts a window of gateway models and reaches later models by scrolling the settings pane', () => {
    render(
      <TestModelList
        models={Array.from({ length: 100 }, (_, index) => ({
          id: `model-${index}`,
          name: `Gateway model ${index}`,
          group: 'Gateway provider',
          source: 'gateway'
        }))}
        loaded
        loading={false}
        disabled={false}
        loadDisabled={false}
        onLoad={async () => {}}
        onSelect={async () => true}
      />
    )
    expect(screen.getByText('Gateway model 0')).toBeVisible()
    expect(screen.queryByText('Gateway model 40')).not.toBeInTheDocument()

    const viewport = screen.getByRole('region', { name: 'Model settings' })
    fireEvent.scroll(viewport, { target: { scrollTop: 1680 } })

    expect(screen.getByText('Gateway model 40')).toBeVisible()
    expect(screen.queryByText('Gateway model 0')).not.toBeInTheDocument()
  })

  it('combines the official catalog and provider groups, applying restrictions per row', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn(async () => true)
    render(
      <TestModelList
        models={[
          {
            id: 'openai/native',
            name: 'Native model',
            description: 'Official model description',
            source: 'native',
            group: 'OpenAI'
          },
          { id: 'anthropic/native', name: 'Other native model', source: 'native' },
          { id: 'gateway', name: 'Gateway model', description: 'Gateway details', source: 'gateway', group: 'OpenAI' }
        ]}
        sourceRestrictions={{ native: 'Default switching unavailable' }}
        followCliLabel="默认模型"
        loaded
        loading={false}
        disabled={false}
        loadDisabled={false}
        onLoad={async () => {}}
        onSelect={onSelect}
      />
    )
    expect(screen.getByRole('button', { name: '默认模型' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Native model' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Other native model' })).toBeDisabled()
    const gateway = screen.getByRole('button', { name: 'Gateway model' })
    expect(gateway).toBeEnabled()
    await user.hover(gateway)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.pointerMove(screen.getByRole('button', { name: 'Native model' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Default switching unavailable$/)

    await user.click(screen.getByRole('button', { name: '官方订阅' }))
    expect(screen.queryByRole('button', { name: 'Native model' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Other native model' })).not.toBeInTheDocument()
    expect(gateway).toBeVisible()
    await user.click(gateway)
    expect(onSelect).toHaveBeenCalledWith('gateway')
  })

  it('keeps providers with identical display names independently collapsible', async () => {
    const user = userEvent.setup()
    render(
      <TestModelList
        models={[
          { id: 'alpha', name: 'Alpha', source: 'gateway', group: 'Provider', providerId: 'provider-a' },
          { id: 'beta', name: 'Beta', source: 'gateway', group: 'Provider', providerId: 'provider-b' }
        ]}
        loaded
        loading={false}
        disabled={false}
        loadDisabled={false}
        onLoad={async () => {}}
        onSelect={async () => true}
      />
    )
    const [first] = screen.getAllByRole('button', { name: 'Provider' })
    await user.click(first)
    expect(screen.queryByRole('button', { name: 'Alpha' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Beta' })).toBeVisible()
  })

  it('replaces the empty state when provider models load', () => {
    const props = {
      loaded: true,
      loading: false,
      disabled: false,
      loadDisabled: false,
      onLoad: async () => {},
      onSelect: async () => true
    }
    const { rerender } = render(<TestModelList {...props} models={[]} />)
    expect(screen.getByText('此 CLI 未返回可选模型，请沿用其原生配置。')).toBeVisible()
    rerender(
      <TestModelList
        {...props}
        models={[{ id: 'gateway', name: 'Gateway model', source: 'gateway', group: 'OpenAI' }]}
      />
    )
    expect(screen.queryByText('此 CLI 未返回可选模型，请沿用其原生配置。')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'OpenAI' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Gateway model' })).toBeVisible()
  })

  it('shows refresh progress only after a manual click, not during background loading', async () => {
    const user = userEvent.setup()
    const pending = Promise.withResolvers<void>()
    const props = {
      models: [{ id: 'alpha', name: 'Alpha' }],
      loaded: true,
      disabled: false,
      loadDisabled: false,
      onLoad: vi.fn(() => pending.promise),
      onSelect: async () => true
    }
    const { rerender } = render(<TestModelList {...props} loading />)
    const button = screen.getByRole('button', { name: '同步模型' })
    expect(button).toHaveAttribute('aria-busy', 'false')
    expect(button).toBeEnabled()
    await user.click(button)
    expect(props.onLoad).not.toHaveBeenCalled()
    expect(button).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByRole('button', { name: /Alpha$/ })).toBeVisible()
    rerender(<TestModelList {...props} loading={false} />)
    await user.click(button)
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeEnabled()
    await user.click(button)
    expect(props.onLoad).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve())
    expect(button).toHaveAttribute('aria-busy', 'false')
    expect(button).toBeEnabled()
  })

  it('finds models in a collapsed group without changing the default', () => {
    const onSelect = vi.fn(async () => true)
    render(
      <TestModelList
        models={[
          { id: 'openai/gpt-5', name: 'GPT 5' },
          { id: 'openai/gpt-4', name: 'GPT 4' },
          { id: 'gateway', name: 'Gateway GPT 5', source: 'gateway', group: 'OpenAI' }
        ]}
        loaded
        loading={false}
        disabled={false}
        loadDisabled={false}
        onLoad={async () => {}}
        onSelect={onSelect}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '官方订阅' }))
    expect(screen.queryByRole('button', { name: 'GPT 5' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    const search = screen.getByRole('textbox')
    expect(search).toHaveFocus()
    fireEvent.change(search, { target: { value: 'GPT 5' } })
    expect(screen.getByRole('button', { name: 'GPT 5' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Gateway GPT 5' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /GPT 4$/ })).not.toBeInTheDocument()

    fireEvent.keyDown(search, { key: 'Escape' })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('can select a provider model by keyboard when official subscription models are read-only', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn(async () => true)
    render(
      <LocalAgentModelSelector
        trigger={<button type="button">Models</button>}
        models={[
          { id: 'gateway', name: 'Gateway model', source: 'gateway', group: 'Provider A' },
          { id: 'native', name: 'Native model', source: 'native' }
        ]}
        value="native"
        sourceRestrictions={{ native: 'Default switching unavailable' }}
        loaded
        onLoad={async () => {}}
        onSelect={onSelect}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Models' }))
    const native = screen.getByRole('option', { name: 'Native model', selected: true })
    expect(native).toHaveAttribute('aria-disabled', 'true')
    expect(native).toHaveAccessibleDescription('Default switching unavailable')
    expect(screen.getByRole('option', { name: 'Gateway model' })).toBeVisible()
    await user.click(native)
    expect(onSelect).not.toHaveBeenCalled()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledWith('gateway')
  })

  it('keeps the active gateway option available to the search field during keyboard navigation', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn(async () => true)
    render(
      <LocalAgentModelSelector
        trigger={<button type="button">Models</button>}
        models={Array.from({ length: 100 }, (_, index) => ({
          id: `model-${index}`,
          name: `Gateway model ${index}`,
          group: 'Gateway provider',
          source: 'gateway'
        }))}
        value="model-70"
        loaded
        onLoad={async () => {}}
        onSelect={onSelect}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Models' }))
    const search = screen.getByRole('textbox')
    const selected = screen.getByRole('option', { name: 'Gateway model 70', selected: true })
    expect(search).toHaveAttribute('aria-activedescendant', selected.id)
    expect(screen.queryByRole('option', { name: 'Gateway model 99' })).not.toBeInTheDocument()

    await user.keyboard('{PageDown}')
    const next = screen.getByRole('option', { name: 'Gateway model 82' })
    expect(search).toHaveAttribute('aria-activedescendant', next.id)
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('model-82')
  })

  it('searches official and provider groups together and selects the visible model with the keyboard', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn(async () => true)
    render(
      <LocalAgentModelSelector
        trigger={<button type="button">Models</button>}
        models={[
          { id: 'native', name: 'Beta Native', source: 'native' },
          { id: 'alpha', name: 'Alpha', source: 'gateway', group: 'Provider A' },
          { id: 'beta', name: 'Beta', source: 'gateway', group: 'Provider B' }
        ]}
        value="alpha"
        loaded
        onLoad={async () => {}}
        onSelect={onSelect}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Models' }))
    const search = screen.getByRole('textbox')
    expect(search).toHaveFocus()
    await user.type(search, 'Beta')
    expect(screen.getByRole('option', { name: 'Beta Native' })).toBeVisible()
    expect(screen.getByRole('option', { name: 'Beta' })).toBeVisible()
    await user.clear(search)
    await user.type(search, 'Provider B')
    expect(screen.getByRole('option', { name: 'Beta' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Alpha' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Beta Native' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清除' }))
    expect(search).toHaveFocus()
    expect(screen.getByRole('option', { name: 'Alpha', selected: true })).toBeVisible()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledWith('beta')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  })

  it('filters official and provider models by the same capability', async () => {
    const user = userEvent.setup()
    render(
      <LocalAgentModelSelector
        trigger={<button type="button">Models</button>}
        models={[
          { id: 'native', name: 'Native model', source: 'native', tags: ['image-recognition'] },
          {
            id: 'gw-reasoning',
            name: 'DeepSeek R1',
            source: 'gateway',
            group: 'CherryIN',
            tags: ['reasoning', 'function-call']
          },
          {
            id: 'gw-vision',
            name: 'Kimi VL',
            source: 'gateway',
            group: 'CherryAI',
            tags: ['image-recognition', 'free']
          }
        ]}
        value="gw-reasoning"
        loaded
        onLoad={async () => {}}
        onSelect={async () => true}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Models' }))
    const filterBar = screen.getByTestId('model-selector-filter-tags')
    await user.click(within(filterBar).getByText('视觉'))
    expect(screen.getByRole('option', { name: 'Native model' })).toBeVisible()
    expect(screen.getByRole('option', { name: 'Kimi VL' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'DeepSeek R1' })).not.toBeInTheDocument()
    await user.click(within(filterBar).getByText('视觉'))
    expect(screen.getByRole('option', { name: 'DeepSeek R1' })).toBeVisible()
    expect(screen.getByRole('option', { name: 'Kimi VL' })).toBeVisible()
  })
})
