import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AgentPlanBlock } from '../AgentPlanBlock'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('Agent execution plans', () => {
  it('replaces the full plan, including removed steps and completed states', () => {
    const { rerender } = render(
      <AgentPlanBlock
        data={{
          entries: [
            { content: 'Inspect files', priority: 'high', status: 'in_progress' },
            { content: 'Old step', priority: 'low', status: 'pending' }
          ]
        }}
      />
    )
    expect(screen.getByText('Inspect files')).toBeInTheDocument()
    rerender(
      <AgentPlanBlock data={{ entries: [{ content: 'Inspect files', priority: 'high', status: 'completed' }] }} />
    )
    expect(screen.queryByText('Old step')).not.toBeInTheDocument()
    expect(screen.getByText('message.tools.completed')).toBeInTheDocument()
    rerender(<AgentPlanBlock data={{ entries: [] }} />)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})
