import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { LocalAgentModelOption } from '@renderer/hooks/agent/useLocalAgentModelSelection'

import { LocalAgentModelSelector } from '../../LocalAgentModelSelector'
import { LocalAgentModelList } from '../LocalAgentModelList'

vi.unmock('@cherrystudio/ui')

describe('local agent model search', () => {
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
    const native = screen.getByRole('tab', { name: '智能体模型' })
    const gateway = screen.getByRole('tab', { name: '服务商模型' })
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
    const availableGateway = screen.getByRole('tab', { name: '服务商模型' })
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
    const native = screen.getByRole('tab', { name: '智能体模型' })
    expect(native).toBeDisabled()
    expect(screen.getByRole('tab', { name: '服务商模型' })).toBeDisabled()
    expect(screen.getByText('此 CLI 未返回可选模型，请沿用其原生配置。')).toBeVisible()
    await user.hover(native.parentElement!)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('此智能体暂无可选的智能体模型。')
    rerender(<LocalAgentModelList {...props} models={[{ id: 'gateway', name: 'Gateway model', source: 'gateway' }]} />)
    expect(screen.getByRole('tab', { name: '服务商模型' })).toHaveAttribute('aria-selected', 'true')
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

  it('expands and focuses search, filters models, and restores the list when collapsed', () => {
    render(
      <LocalAgentModelList
        models={[
          { id: 'alpha', name: 'Alpha' },
          { id: 'beta', name: 'Beta' }
        ]}
        loaded
        loading={false}
        disabled={false}
        loadDisabled={false}
        onLoad={async () => {}}
        onSelect={async () => true}
      />
    )
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    const input = screen.getByRole('textbox')
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: 'Alpha' } })
    expect(screen.getByRole('button', { name: /Alpha$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Beta$/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Beta$/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
  it('groups model families, supports collapsing, and reveals search matches in closed groups', () => {
    render(
      <LocalAgentModelList
        models={[
          { id: 'openai/gpt-5', name: 'GPT 5' },
          { id: 'openai/gpt-4', name: 'GPT 4' },
          { id: 'claude-sonnet', name: 'Sonnet' },
          { id: 'default', name: 'Default' }
        ]}
        groupFallback="CLI Agent"
        loaded
        loading={false}
        disabled={false}
        loadDisabled={false}
        onLoad={async () => {}}
        onSelect={async () => true}
      />
    )
    expect(within(screen.getByRole('region', { name: 'openai' })).getByRole('button', { name: /GPT 5$/ })).toBeVisible()
    expect(
      within(screen.getByRole('region', { name: 'claude' })).getByRole('button', { name: /Sonnet$/ })
    ).toBeVisible()
    expect(
      within(screen.getByRole('region', { name: 'CLI Agent' })).getByRole('button', { name: /Default$/ })
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'openai' }))
    expect(screen.queryByRole('button', { name: /GPT 5$/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'GPT 5' } })
    expect(screen.getByRole('button', { name: /GPT 5$/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /GPT 4$/ })).not.toBeInTheDocument()
  })
  it('opens the selected category and lets users browse and search without changing the model', () => {
    const onSelect = vi.fn(async () => true)
    render(
      <LocalAgentModelList
        models={[
          { id: 'gateway-model:test', name: 'Gateway model', group: 'Provider A', source: 'gateway' },
          { id: 'native-model', name: 'Native model', group: 'CLI vendor', source: 'native' }
        ]}
        value="gateway-model:test"
        loaded
        loading={false}
        disabled={false}
        loadDisabled={false}
        onLoad={async () => {}}
        onSelect={onSelect}
      />
    )
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['智能体模型', '服务商模型'])
    expect(screen.getByRole('tab', { name: '服务商模型' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: /Gateway model$/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: '跟随 CLI' })).not.toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('tab', { name: '智能体模型' }), { button: 0, ctrlKey: false })
    expect(screen.queryByRole('button', { name: /Gateway model$/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'CLI vendor' }))
    expect(screen.queryByRole('button', { name: /Native model$/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'CLI vendor' } })
    expect(screen.getByRole('button', { name: /Native model$/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Gateway model$/ })).not.toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })
  it('reopens the chat selector on the selected model category after browsing another tab', async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn()
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
    expect(screen.getByRole('tab', { name: '服务商模型' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: '智能体模型' }))
    expect(screen.getByRole('option', { name: /Native model/ })).toBeVisible()
    expect(screen.queryByRole('option', { name: /Gateway model/ })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Models' }))
    expect(screen.getByRole('tab', { name: '服务商模型' })).toHaveAttribute('aria-selected', 'true')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('searches within the current source and selects the visible model with the keyboard', async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn()
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
})
