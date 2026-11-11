import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { TaskRunSummaryLine } from '../TaskRunSummaryLine'

describe('TaskRunSummaryLine', () => {
  it('shows a skipped guard distinctly from a succeeded agent run', () => {
    const view = render(<TaskRunSummaryLine summary={{ status: 'skipped', finishedAt: '2026-05-20T00:00:05.000Z' }} />)
    expect(screen.getByText(/agent.tasks.logs.skipped/)).toBeInTheDocument()
    expect(screen.queryByText(/agent.tasks.runSummary.completed/)).not.toBeInTheDocument()
    view.rerender(<TaskRunSummaryLine summary={{ status: 'completed', finishedAt: '2026-05-20T00:00:05.000Z' }} />)
    expect(screen.getByText('agent.tasks.runSummary.completed')).toBeInTheDocument()
    expect(screen.queryByText(/agent.tasks.logs.skipped/)).not.toBeInTheDocument()
  })
})
