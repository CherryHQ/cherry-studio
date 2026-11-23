import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { KnowledgeFilePreflight } from '@shared/data/presets/knowledgeFormats'

import { KnowledgeFilePreflightDialog } from '../KnowledgeFilePreflightDialog'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const failed: KnowledgeFilePreflight = {
  path: '/docs/scanned.pdf',
  processor: 'pdf',
  pageCount: 1,
  reason: 'ocr_required'
}

describe('knowledge preflight review', () => {
  it('never accepts an all-blocked batch, provides settings recovery and cancels without importing', () => {
    const onContinue = vi.fn(),
      onCancel = vi.fn(),
      onConfigure = vi.fn()
    render(
      <KnowledgeFilePreflightDialog
        results={[failed]}
        onContinue={onContinue}
        onCancel={onCancel}
        onConfigure={onConfigure}
      />
    )
    expect(screen.getByText('scanned.pdf')).toBeInTheDocument()
    expect(screen.getByText('knowledge.preflight.reason.ocr_required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'knowledge.preflight.continue' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'knowledge.preflight.configure' }))
    expect(onConfigure).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onContinue).not.toHaveBeenCalled()
  })
  it('waits for explicit confirmation even when a file is ready and shows the selected reader', () => {
    const onContinue = vi.fn()
    render(
      <KnowledgeFilePreflightDialog
        results={[{ path: '/docs/slides.pptx', processor: 'anydoc', reason: 'ok' }]}
        onContinue={onContinue}
        onCancel={vi.fn()}
        onConfigure={vi.fn()}
      />
    )
    expect(screen.getAllByText('knowledge.preflight.reader.anydoc').length).toBeGreaterThan(0)
    expect(onContinue).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'knowledge.preflight.continue' }))
    expect(onContinue).toHaveBeenCalledOnce()
  })
})
