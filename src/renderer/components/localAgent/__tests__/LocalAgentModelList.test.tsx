import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LocalAgentModelOption } from '@renderer/hooks/agent/useLocalAgentModelSelection'

import { LocalAgentModelSelector } from '../../LocalAgentModelSelector'
import { LocalAgentModelList } from '../LocalAgentModelList'

vi.unmock('@cherrystudio/ui')

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
      <LocalAgentModelList
        models={Array.from({ length: 100 }, (_, index) => ({
          id: `model-${index}`,
          name: `Gateway model ${index}`,
          group: 'Gateway provider',
          source: 'gateway'
        }))}
        showFollowCli={false}
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

    const tabPanel = screen.getByRole('tabpanel')
    const viewport = tabPanel.querySelector('[data-slot="scroll-area-viewport"]')!
    fireEvent.scroll(viewport, { target: { scrollTop: 1680 } })

    expect(screen.getByText('Gateway model 40')).toBeVisible()
    expect(screen.queryByText('Gateway model 0')).not.toBeInTheDocument()
    expect(viewport).not.toContainElement(screen.getByRole('tab', { name: '统一网关' }))
    expect(viewport).not.toContainElement(screen.getByRole('button', { name: '搜索' }))
  })

  it('allows browsing and refreshing restricted model sources without changing the default', async () => {
    const user = userEvent.setup()
    const onLoad = vi.fn(async () => {})
    const onSelect = vi.fn(async () => true)
    render(
      <LocalAgentModelList
        models={[
          { id: 'native', name: 'Native model', source: 'native' },
          { id: 'gateway', name: 'Gateway model', source: 'gateway' }
        ]}
        sourceRestrictions={{ native: 'Default switching unavailable', gateway: 'Provider switching unavailable' }}
        loaded
        loading={false}
        disabled={false}
        loadDisabled={false}
        onLoad={onLoad}
        onSelect={onSelect}
      />
    )
    const native = screen.getByRole('tab', { name: '官方订阅' })
    expect(native).toBeEnabled()
    expect(native).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: '默认模型' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Native model$/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Native model$/ }))
    await user.click(screen.getByRole('button', { name: '刷新' }))
    expect(onLoad).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('tab', { name: '统一网关' }))
    expect(screen.getByRole('tab', { name: '统一网关' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: /Gateway model$/ })).toBeDisabled()
    await user.click(native)
    expect(screen.getByRole('button', { name: /Native model$/ })).toBeVisible()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps unavailable provider models visible, explains the disabled state, and enables them after loading', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn(async () => true)
    const props = {
      models: [{ id: 'native', name: 'Native model', source: 'native' }] as LocalAgentModelOption[],
      loaded: true,
      loading: false,
      disabled: false,
      loadDisabled: false,
      onLoad: async () => {},
      onSelect
    }
    const { rerender } = render(<LocalAgentModelList {...props} />)
    const native = screen.getByRole('tab', { name: '官方订阅' })
    const gateway = screen.getByRole('tab', { name: '统一网关' })
    expect(native).toHaveAttribute('aria-selected', 'true')
    expect(gateway).toBeDisabled()
    await user.hover(gateway.parentElement!)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('此智能体暂无可用的服务商模型。')
    await user.keyboard('{Escape}')
    await user.click(native)
    await user.keyboard('{ArrowRight}')
    expect(native).toHaveAttribute('aria-selected', 'true')
    rerender(
      <LocalAgentModelList
        {...props}
        models={[...props.models, { id: 'gateway', name: 'Gateway model', source: 'gateway' }]}
      />
    )
    const availableGateway = screen.getByRole('tab', { name: '统一网关' })
    expect(availableGateway).toBeEnabled()
    await user.click(availableGateway)
    expect(screen.getByRole('button', { name: /Gateway model$/ })).toBeVisible()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps the empty state visible when both sources are disabled and selects the first available source after loading', async () => {
    const user = userEvent.setup()
    const props = {
      showFollowCli: false,
      loaded: true,
      loading: false,
      disabled: false,
      loadDisabled: false,
      onLoad: async () => {},
      onSelect: async () => true
    }
    const { rerender } = render(<LocalAgentModelList {...props} models={[]} />)
    const native = screen.getByRole('tab', { name: '官方订阅' })
    expect(native).toBeDisabled()
    expect(screen.getByRole('tab', { name: '统一网关' })).toBeDisabled()
    expect(screen.getByText('此 CLI 未返回可选模型，请沿用其原生配置。')).toBeVisible()
    await user.hover(native.parentElement!)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('此智能体暂无可选的官方模型。')
    rerender(<LocalAgentModelList {...props} models={[{ id: 'gateway', name: 'Gateway model', source: 'gateway' }]} />)
    expect(screen.getByRole('tab', { name: '统一网关' })).toHaveAttribute('aria-selected', 'true')
    expect(native).toBeDisabled()
    expect(screen.getByRole('button', { name: /Gateway model$/ })).toBeVisible()
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
    const { rerender } = render(<LocalAgentModelList {...props} loading />)
    const button = screen.getByRole('button', { name: '刷新' })
    expect(button).toHaveAttribute('aria-busy', 'false')
    expect(button).toBeEnabled()
    await user.click(button)
    expect(props.onLoad).not.toHaveBeenCalled()
    expect(button).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByRole('button', { name: /Alpha$/ })).toBeVisible()
    rerender(<LocalAgentModelList {...props} loading={false} />)
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
      <LocalAgentModelList
        models={[
          { id: 'openai/gpt-5', name: 'GPT 5' },
          { id: 'openai/gpt-4', name: 'GPT 4' }
        ]}
        loaded
        loading={false}
        disabled={false}
        loadDisabled={false}
        onLoad={async () => {}}
        onSelect={onSelect}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'openai' }))
    expect(screen.queryByRole('button', { name: /GPT 5$/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    const search = screen.getByRole('textbox')
    expect(search).toHaveFocus()
    fireEvent.change(search, { target: { value: 'GPT 5' } })
    expect(screen.getByRole('button', { name: /GPT 5$/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /GPT 4$/ })).not.toBeInTheDocument()

    fireEvent.keyDown(search, { key: 'Escape' })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('reopens the chat selector on the selected model category after browsing another tab', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn(async () => true)
    render(
      <LocalAgentModelSelector
        trigger={<button type="button">Models</button>}
        models={[
          { id: 'gateway', name: 'Gateway model', source: 'gateway' },
          { id: 'native', name: 'Native model', source: 'native' }
        ]}
        value="gateway"
        loaded
        onLoad={async () => {}}
        onSelect={onSelect}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Models' }))
    expect(screen.getByRole('tab', { name: '统一网关' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: '官方订阅' }))
    expect(screen.getByRole('option', { name: /Native model/ })).toBeVisible()
    expect(screen.queryByRole('option', { name: /Gateway model/ })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Models' }))
    expect(screen.getByRole('tab', { name: '统一网关' })).toHaveAttribute('aria-selected', 'true')
    expect(onSelect).not.toHaveBeenCalled()
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

  it('searches within the current source and selects the visible model with the keyboard', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn(async () => true)
    render(
      <LocalAgentModelSelector
        trigger={<button type="button">Models</button>}
        models={[
          { id: 'native', name: 'Native model', source: 'native' },
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
    await user.type(search, 'Provider B')
    expect(screen.getByRole('option', { name: 'Beta' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Alpha' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Native model' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清除' }))
    expect(search).toHaveFocus()
    expect(screen.getByRole('option', { name: 'Alpha', selected: true })).toBeVisible()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledWith('beta')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  })

  it('shows gateway capability filter pills and full row tags, filtering gateway models and resetting across tabs', async () => {
    const user = userEvent.setup()
    render(
      <LocalAgentModelSelector
        trigger={<button type="button">Models</button>}
        models={[
          { id: 'native', name: 'Native model', source: 'native' },
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
    expect(screen.getByRole('tab', { name: '统一网关' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('CherryIN')).toBeVisible()
    expect(screen.getByText('CherryAI')).toBeVisible()

    const reasoningOption = screen.getByRole('option', { name: 'DeepSeek R1' })
    expect(reasoningOption.querySelector('.lucide-lightbulb')).toBeInTheDocument()
    expect(reasoningOption.querySelector('.lucide-wrench')).toBeInTheDocument()
    const visionOption = screen.getByRole('option', { name: 'Kimi VL' })
    expect(visionOption.querySelector('.lucide-eye')).toBeInTheDocument()
    expect(within(visionOption).getByText('免费')).toBeVisible()

    const filterBar = screen.getByTestId('model-selector-filter-tags')
    await user.click(within(filterBar).getByText('视觉'))
    expect(screen.getByRole('option', { name: 'Kimi VL' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'DeepSeek R1' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '官方订阅' }))
    expect(screen.queryByTestId('model-selector-filter-tags')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '统一网关' }))
    expect(screen.getByRole('option', { name: 'DeepSeek R1' })).toBeVisible()
    expect(screen.getByRole('option', { name: 'Kimi VL' })).toBeVisible()
  })
})
