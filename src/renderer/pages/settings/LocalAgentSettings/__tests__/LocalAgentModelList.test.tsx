import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LocalAgentModelList } from '../LocalAgentModelList'

vi.unmock('@cherrystudio/ui')

describe('local agent model search', () => {
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
})
