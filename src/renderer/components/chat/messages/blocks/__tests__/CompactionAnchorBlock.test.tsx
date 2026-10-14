import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CompactionAnchorData } from '@shared/ai/compaction'

import CompactionAnchorBlock from '../CompactionAnchorBlock'

const translations: Record<string, string> = {
  'chat.compaction.compacting': 'Compacting context…',
  'chat.compaction.compacted': 'Compacted {{count}} tokens',
  'chat.compaction.compacted_plain': 'Context compacted'
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, number | string>) => {
      const template = translations[key] ?? key
      if (!options) return template
      return Object.entries(options).reduce(
        (result, [name, value]) => result.replace(`{{${name}}}`, String(value)),
        template
      )
    }
  })
}))

const anchor = (data: Partial<CompactionAnchorData>): CompactionAnchorData => ({
  status: 'done',
  phase: 'in-loop',
  ...data
})

describe('CompactionAnchorBlock', () => {
  it('shows a spinner label while compacting', () => {
    render(<CompactionAnchorBlock data={anchor({ status: 'compacting' })} />)
    expect(screen.getByText('Compacting context…')).toBeInTheDocument()
  })

  it('reports what a real fold reclaimed', () => {
    render(<CompactionAnchorBlock data={anchor({ preTokens: 5_000, postTokens: 1_000 })} />)
    expect(screen.getByText('Compacted 4000 tokens')).toBeInTheDocument()
  })

  // #17837: a fold that changed nothing used to settle as `done`, so an untouched history
  // rendered "Context compacted". `skipped` must draw nothing at all.
  it('renders nothing for a skipped (no-op) fold', () => {
    const { container } = render(<CompactionAnchorBlock data={anchor({ status: 'skipped' })} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText('Context compacted')).not.toBeInTheDocument()
    expect(screen.queryByText('Compacting context…')).not.toBeInTheDocument()
  })

  it('renders nothing for a skipped turn-start fold either', () => {
    const { container } = render(<CompactionAnchorBlock data={anchor({ status: 'skipped', phase: 'turn-start' })} />)
    expect(container).toBeEmptyDOMElement()
  })
})
