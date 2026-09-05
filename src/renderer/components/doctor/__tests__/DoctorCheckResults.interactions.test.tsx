import '@testing-library/jest-dom/vitest'

import { Dialog, DialogContent, DialogTitle } from '@cherrystudio/ui'
import type { DoctorController, DoctorInteraction } from '@renderer/hooks/doctor'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@cherrystudio/ui')

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { DoctorCheckResults } from '../DoctorCheckResults'
import { DoctorChecksPanel } from '../DoctorChecksPanel'

function createController(): DoctorController {
  return {
    appUpdateState: { downloaded: false },
    executeAction: vi.fn(),
    isInteracting: false,
    mcpServerName: vi.fn(),
    requestEvidence: vi.fn(),
    session: {
      expandedDomains: ['runtime'],
      interaction: { kind: 'idle' },
      revealedEvidence: []
    },
    setExpandedDomains: vi.fn(),
    viewModel: {
      groups: [
        {
          domain: 'runtime',
          status: 'warn',
          rows: [
            {
              id: 'runtime-claude-login',
              domain: 'runtime',
              status: 'warn',
              result: {
                id: 'runtime-claude-login',
                status: 'warn',
                durationMs: 1,
                attribution: 'user-fixable',
                detail: { variant: 'signed_out' },
                evidence: [{ key: 'request-body', value: 'private Doctor evidence', dataClass: 'consent_required' }],
                actions: [
                  { kind: 'navigate', target: '/settings/provider?id=claude-code' },
                  { kind: 'navigate', target: '/settings/mcp' },
                  { kind: 'navigate', target: '/settings/general' }
                ]
              },
              actions: [
                { kind: 'navigate', target: '/settings/provider?id=claude-code' },
                { kind: 'navigate', target: '/settings/mcp' },
                { kind: 'navigate', target: '/settings/general' }
              ],
              actionsDisabled: false
            }
          ]
        }
      ]
    }
  } as unknown as DoctorController
}

function createPanelController(): DoctorController {
  return {
    ...createController(),
    cancel: vi.fn(),
    canChangePanel: true,
    openLogsPath: vi.fn(),
    openPath: vi.fn(),
    run: vi.fn(),
    session: {
      expandedDomains: [],
      interaction: { kind: 'idle' },
      relaunchRequired: false,
      revealedEvidence: []
    },
    setPanel: vi.fn(),
    toggleDevTools: vi.fn(),
    viewModel: {
      canCancel: false,
      groups: [],
      isStale: false,
      problemCount: 0,
      rows: [],
      status: 'canceled',
      summary: { appBug: 0, error: 0, optional: 0, skip: 0, transient: 0, userFixable: 0 }
    }
  } as unknown as DoctorController
}

function EvidenceFocusHarness() {
  const [interaction, setInteraction] = useState<DoctorInteraction>({ kind: 'idle' })
  const [revealedEvidence, setRevealedEvidence] = useState<DoctorController['session']['revealedEvidence']>([])
  const baseController = createController()
  const controller = {
    ...baseController,
    cancelFixConfirmation: () => setInteraction({ kind: 'idle' }),
    confirmEvidence: () => {
      if (interaction.kind !== 'confirm-evidence') return
      setRevealedEvidence([interaction.checkId])
      setInteraction({ kind: 'idle' })
    },
    requestEvidence: (checkId) => setInteraction({ kind: 'confirm-evidence', checkId }),
    session: {
      ...baseController.session,
      interaction,
      relaunchRequired: false,
      revealedEvidence
    },
    viewModel: {
      ...baseController.viewModel,
      rows: baseController.viewModel.groups.flatMap((group) => group.rows),
      status: 'completed',
      summary: { appBug: 0, error: 0, optional: 0, skip: 0, transient: 0, userFixable: 1 }
    }
  } as DoctorController

  return <DoctorChecksPanel controller={controller} />
}

describe('DoctorCheckResults interactions', () => {
  it('includes the group status in the accordion trigger accessible name', () => {
    render(<DoctorCheckResults controller={createController()} />)

    expect(screen.getByRole('button', { name: /settings\.doctor\.status\.warn/ })).toBeInTheDocument()
  })

  it('closes an expanded action menu without dismissing its parent dialog when the trigger is clicked again', async () => {
    const user = userEvent.setup()
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>Error details</DialogTitle>
          <DoctorCheckResults controller={createController()} />
        </DialogContent>
      </Dialog>
    )

    const dialog = screen.getByRole('dialog')
    const more = screen.getByRole('button', { name: 'settings.doctor.actions.more' })
    await user.click(more)
    expect(screen.getByRole('menu')).toBeVisible()

    await user.click(more)

    expect(dialog).toBeVisible()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('keeps the parent dialog open when the footer action menu trigger closes its menu', async () => {
    const user = userEvent.setup()
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>System diagnostics</DialogTitle>
          <DoctorChecksPanel controller={createPanelController()} />
        </DialogContent>
      </Dialog>
    )

    const dialog = screen.getByRole('dialog')
    const more = screen.getByRole('button', { name: 'settings.doctor.actions.more' })
    await user.click(more)
    expect(screen.getByRole('menu')).toBeVisible()

    await user.click(more)

    expect(dialog).toBeVisible()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('moves focus to newly revealed evidence after consent', async () => {
    const user = userEvent.setup()
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>System diagnostics</DialogTitle>
          <EvidenceFocusHarness />
        </DialogContent>
      </Dialog>
    )

    expect(screen.queryByText('private Doctor evidence')).not.toBeInTheDocument()
    expect(screen.getByText('••••••')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'settings.doctor.actions.show_details' }))
    await user.click(screen.getByRole('button', { name: 'settings.doctor.actions.show_details' }))

    const evidence = screen.getByText('private Doctor evidence').closest('dl')
    expect(evidence).toHaveFocus()
  })
})
