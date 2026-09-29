import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LocalAgentModelList } from '../LocalAgentModelList'

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
})
