import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import OpenUiPreview from '../OpenUiPreview'

vi.unmock('@cherrystudio/ui')

const RESPONSE = `root = Panel("Release summary", [Text("<script>alert(1)</script>"), Metric("Checks", 12, "All passed"), DataTable(["Package", "Status", "Failures"], [["OpenUI", "Ready", 0]])])`

describe('OpenUiPreview', () => {
  it('renders model output with the real library and keeps text inert', async () => {
    render(<OpenUiPreview>{RESPONSE}</OpenUiPreview>)

    expect(await screen.findByRole('heading', { name: 'Release summary' })).toBeInTheDocument()
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Package' })).toBeInTheDocument()
    expect(within(table).getByRole('cell', { name: 'Ready' })).toBeInTheDocument()
    expect(within(table).getByRole('cell', { name: '0' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('updates an incomplete response when streaming finishes', async () => {
    const { rerender } = render(
      <OpenUiPreview isStreaming>{'root = Panel("Release summary", [Text("Partial'}</OpenUiPreview>
    )

    expect(await screen.findByRole('heading', { name: 'Release summary' })).toBeInTheDocument()
    expect(screen.getByText('Partial')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    rerender(<OpenUiPreview>{RESPONSE}</OpenUiPreview>)

    expect(await screen.findByRole('cell', { name: 'Ready' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports an unknown component and recovers when the source is corrected', async () => {
    const { rerender } = render(<OpenUiPreview>{'root = Unknown("content")'}</OpenUiPreview>)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    rerender(<OpenUiPreview>{RESPONSE}</OpenUiPreview>)

    expect(await screen.findByRole('cell', { name: 'Ready' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
