import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { Accordion, Dialog, DialogContent, DialogTitle } from '@cherrystudio/ui'
import type { DoctorController } from '@renderer/hooks/doctor'
import type { DoctorInteraction } from '@renderer/hooks/doctor/doctorSessionReducer'
import { buildDoctorViewModel } from '@renderer/utils/doctor'

vi.unmock('@cherrystudio/ui')

const mocks = vi.hoisted(() => ({
  mcpServers: [{ id: 'filesystem', name: 'Filesystem' }]
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: () => ({ mcpServers: mocks.mcpServers })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { name?: string; check?: string; count?: number }) => {
      if (key === 'settings.doctor.fixes.restart_mcp') return `Restart ${params?.name}`
      if (key === 'settings.doctor.fixes.restart_mcp_generic') return 'Restart MCP service'
      if (key === 'error.diagnostics.checking_progress') return `Checking: ${params?.check}`
      if (key === 'settings.doctor.summary.needs_attention') return `Needs attention: ${params?.count}`
      if (key === 'settings.doctor.summary.fixed') return `Fixed: ${params?.count}`
      return key
    }
  })
}))

import { DoctorCheckAccordionItems } from '../DoctorCheckAccordionItems'
import { DoctorChecksPanel } from '../DoctorChecksPanel'

type ControllerOverrides = {
  readonly cancelConfirmation?: DoctorController['cancelConfirmation']
  readonly confirmEvidence?: DoctorController['confirmEvidence']
  readonly isInteracting?: DoctorController['isInteracting']
  readonly requestEvidence?: DoctorController['requestEvidence']
  readonly session?: Partial<DoctorController['session']>
  readonly viewModel?: Partial<DoctorController['viewModel']>
}

function createController(overrides: ControllerOverrides = {}) {
  const baseController = {
    appUpdateState: {
      info: null,
      checking: false,
      downloading: false,
      downloaded: false,
      downloadProgress: 0,
      available: false,
      ignore: false,
      manualCheck: false
    },
    cancel: vi.fn<DoctorController['cancel']>(),
    canChangePanel: true,
    cancelConfirmation: vi.fn<DoctorController['cancelConfirmation']>(),
    confirmCheck: vi.fn<DoctorController['confirmCheck']>(),
    confirmEvidence: vi.fn<DoctorController['confirmEvidence']>(),
    executeAction: vi.fn<DoctorController['executeAction']>(),
    isAutoRunPending: false,
    isInteracting: false,
    isCloseBlocked: false,
    openLogsPath: vi.fn<DoctorController['openLogsPath']>(),
    openPath: vi.fn<DoctorController['openPath']>(),
    requestEvidence: vi.fn<DoctorController['requestEvidence']>(),
    run: vi.fn<DoctorController['run']>(),
    session: {
      activePanel: 'checks',
      descriptionDraft: '',
      fixedCheckIds: [],
      interaction: { kind: 'idle' },
      relaunchRequired: false
    },
    setDescription: vi.fn<DoctorController['setDescription']>(),
    setPanel: vi.fn<DoctorController['setPanel']>(),
    setPanelInteraction: vi.fn<DoctorController['setPanelInteraction']>(),
    toggleDevTools: vi.fn<DoctorController['toggleDevTools']>(),
    viewModel: {
      activeCheckIds: [],
      canCancel: false,
      groups: [],
      isStale: false,
      pendingChecks: [],
      problemCount: 1,
      rows: [
        {
          domain: 'runtime',
          status: 'warn',
          id: 'runtime-claude-login',
          result: {
            id: 'runtime-claude-login',
            status: 'warn',
            durationMs: 1,
            attribution: 'user-fixable',
            detail: { variant: 'not_logged_in' },
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
      ],
      status: 'completed',
      summary: { appBug: 0, error: 0, skip: 0, transient: 0, userFixable: 1 }
    }
  } satisfies DoctorController

  return {
    ...baseController,
    ...overrides,
    session: { ...baseController.session, ...overrides.session },
    viewModel: {
      ...baseController.viewModel,
      ...overrides.viewModel,
      pendingChecks: overrides.viewModel?.pendingChecks ?? baseController.viewModel.pendingChecks
    }
  } satisfies DoctorController
}

function createPanelController() {
  return createController({
    viewModel: {
      groups: [],
      problemCount: 0,
      rows: [],
      status: 'canceled',
      summary: { appBug: 0, error: 0, skip: 0, transient: 0, userFixable: 0 }
    }
  })
}

function createCompletedPanelController() {
  const controller = createPanelController()
  const row = createController().viewModel.rows[0]

  return createController({
    viewModel: {
      ...controller.viewModel,
      runId: 'run-1',
      problemCount: 1,
      report: {
        schemaVersion: 1,
        scope: 'global',
        runId: 'run-1',
        tier: 'quick',
        selectedCheckIds: ['config-boot-config-valid', 'storage-disk-space'],
        startedAt: '2026-09-05T00:00:00.000Z',
        finishedAt: '2026-09-05T00:00:01.000Z',
        expiresAt: '2026-09-05T00:10:00.000Z',
        basics: {
          version: '2.0.0',
          edition: 'global',
          channel: 'latest',
          platform: 'darwin',
          arch: 'arm64',
          osRelease: '25.0.0',
          runtime: {},
          isPackaged: true,
          isPortable: false
        },
        results: [row.result!],
        summary: { pass: 0, warn: 1, fail: 0, skip: 0, error: 0 }
      },
      rows: [row],
      groups: [{ domain: 'runtime', status: 'warn', rows: [row] }],
      status: 'completed',
      summary: { appBug: 0, error: 0, skip: 0, transient: 0, userFixable: 1 }
    }
  })
}

function createSecondaryEvidencePanelController() {
  const controller = createCompletedPanelController()
  const evidenceRow = controller.viewModel.rows[0]
  const firstRow = {
    domain: 'runtime',
    status: 'warn',
    id: 'runtime-managed-tools',
    result: {
      id: 'runtime-managed-tools',
      status: 'warn',
      durationMs: 1,
      attribution: 'user-fixable',
      detail: { variant: 'failed' },
      evidence: [],
      actions: []
    },
    actions: [],
    actionsDisabled: false
  } satisfies DoctorController['viewModel']['rows'][number]
  const rows = [firstRow, evidenceRow]

  return createController({
    viewModel: {
      ...controller.viewModel,
      rows,
      groups: [{ domain: 'runtime', status: 'warn', rows }]
    }
  })
}

function EvidenceFocusHarness() {
  const [interaction, setInteraction] = useState<DoctorInteraction>({ kind: 'idle' })
  const [evidenceGrant, setEvidenceGrant] = useState<DoctorController['session']['evidenceGrant']>()
  const baseController = createSecondaryEvidencePanelController()
  const controller = createController({
    cancelConfirmation: () => setInteraction({ kind: 'idle' }),
    confirmEvidence: () => {
      if (interaction.kind !== 'confirm-evidence') return
      setEvidenceGrant({ runId: interaction.runId, checkIds: [interaction.checkId] })
      setInteraction({ kind: 'idle' })
    },
    requestEvidence: (checkId) => {
      if (!baseController.viewModel.runId) return
      setInteraction({ kind: 'confirm-evidence', runId: baseController.viewModel.runId, checkId })
    },
    session: {
      interaction,
      evidenceGrant
    },
    viewModel: {
      ...baseController.viewModel,
      status: 'completed',
      summary: { appBug: 0, error: 0, skip: 0, transient: 0, userFixable: 1 }
    }
  })

  return <DoctorChecksPanel controller={controller} />
}

describe('DoctorCheckAccordionItems interactions', () => {
  it('keeps the test controller surface in sync with production', () => {
    expectTypeOf<keyof ReturnType<typeof createController>>().toEqualTypeOf<keyof DoctorController>()
  })

  it('shows all check results and updates a repaired check to passed', async () => {
    const controller = createCompletedPanelController()
    const report = controller.viewModel.report!
    const actionable = report.results[0]
    const mixedReport = {
      ...report,
      results: [
        actionable,
        { id: 'install-version-channel', status: 'pass', durationMs: 1 },
        {
          id: 'logs-recent-findings',
          status: 'warn',
          durationMs: 1,
          attribution: 'app-bug',
          detail: { variant: 'findings' },
          actions: [{ kind: 'report' }]
        },
        {
          id: 'network-online',
          status: 'warn',
          durationMs: 1,
          attribution: 'transient',
          detail: { variant: 'offline' },
          actions: []
        }
      ],
      summary: { pass: 1, warn: 3, fail: 0, skip: 0, error: 0 }
    } satisfies NonNullable<DoctorController['viewModel']['report']>
    const viewModel = buildDoctorViewModel({ status: 'completed', report: mixedReport }, Date.parse(report.finishedAt))
    const view = render(<DoctorChecksPanel controller={{ ...controller, viewModel }} />)

    expect(screen.queryByRole('region', { name: 'error.diagnostics.result' })).not.toBeInTheDocument()
    const otherChecks = screen.getByRole('region', { name: 'settings.doctor.copy.checks_heading' })
    for (const id of ['install-version-channel', 'runtime-claude-login', 'logs-recent-findings', 'network-online']) {
      expect(
        within(otherChecks).getByRole('button', { name: new RegExp(`settings.doctor.checks.${id}.title`) })
      ).toBeVisible()
    }
    await userEvent
      .setup()
      .click(within(otherChecks).getByRole('button', { name: /settings\.doctor\.checks\.logs-recent-findings\.title/ }))
    expect(within(otherChecks).getByRole('button', { name: 'settings.doctor.actions.report_problem' })).toBeVisible()
    expect(screen.queryByText('settings.doctor.summary.basic_healthy')).not.toBeInTheDocument()

    view.rerender(
      <DoctorChecksPanel
        controller={{
          ...controller,
          session: { ...controller.session, fixedCheckIds: [actionable.id] },
          viewModel: buildDoctorViewModel(
            {
              status: 'completed',
              report: {
                ...report,
                results: [{ id: 'runtime-claude-login', status: 'pass', durationMs: 1 }],
                summary: { pass: 1, warn: 0, fail: 0, skip: 0, error: 0 }
              }
            },
            Date.parse(report.finishedAt)
          )
        }}
      />
    )

    expect(
      screen.getByRole('button', {
        name: /settings\.doctor\.checks\.runtime-claude-login\.title.*settings\.doctor\.status\.pass/
      })
    ).toBeVisible()
  })

  it('exposes local evidence through an accessible accordion trigger', async () => {
    const user = userEvent.setup()
    render(
      <Accordion type="single" collapsible defaultValue="doctor-runtime-claude-login">
        <DoctorCheckAccordionItems controller={createController()} />
      </Accordion>
    )

    const localEvidenceTrigger = screen.getByRole('button', { name: 'settings.doctor.evidence.local_details' })
    expect(localEvidenceTrigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(localEvidenceTrigger)

    expect(localEvidenceTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('••••••')).toBeVisible()
  })

  it('does not offer evidence confirmation while another Doctor operation is active', async () => {
    const user = userEvent.setup()
    const controller = createController({
      isInteracting: true,
      session: {
        interaction: {
          kind: 'fixing',
          request: {
            scope: 'global',
            runId: 'run-1',
            checkId: 'permission-screen-capture',
            fixId: 'request'
          }
        }
      }
    })
    render(
      <Accordion type="single" collapsible defaultValue="doctor-runtime-claude-login">
        <DoctorCheckAccordionItems controller={controller} />
      </Accordion>
    )

    await user.click(screen.getByRole('button', { name: 'settings.doctor.evidence.local_details' }))

    expect(screen.getByRole('button', { name: 'settings.doctor.actions.show_details' })).toBeDisabled()
  })

  it('masks a previous run evidence grant when a replacement report arrives', () => {
    const completed = createCompletedPanelController()
    const runOneSession = {
      evidenceGrant: { runId: 'run-1', checkIds: ['runtime-claude-login'] as const }
    }
    const runOneViewModel = { ...completed.viewModel, runId: 'run-1' }
    const { rerender } = render(
      <Accordion type="single" collapsible defaultValue="doctor-runtime-claude-login">
        <DoctorCheckAccordionItems
          controller={createController({ session: runOneSession, viewModel: runOneViewModel })}
        />
      </Accordion>
    )

    expect(screen.getByText('private Doctor evidence')).toBeVisible()

    const replacementReport = completed.viewModel.report
    if (!replacementReport) throw new Error('Expected a completed Doctor report')
    rerender(
      <Accordion type="single" collapsible defaultValue="doctor-runtime-claude-login">
        <DoctorCheckAccordionItems
          controller={createController({
            session: runOneSession,
            viewModel: {
              ...runOneViewModel,
              runId: 'run-2',
              report: { ...replacementReport, runId: 'run-2' }
            }
          })}
        />
      </Accordion>
    )

    expect(screen.queryByText('private Doctor evidence')).not.toBeInTheDocument()
    expect(screen.getByText('••••••')).toBeVisible()
  })

  it('labels current and deleted MCP restart targets from the display owner', async () => {
    const user = userEvent.setup()
    const actions = [
      { kind: 'fix', fixId: 'restart', target: 'filesystem' },
      { kind: 'fix', fixId: 'restart', target: 'deleted' }
    ] as const
    const row = {
      domain: 'mcp',
      status: 'warn',
      id: 'mcp-servers-connected',
      result: {
        id: 'mcp-servers-connected',
        status: 'warn',
        durationMs: 1,
        attribution: 'user-fixable',
        detail: { variant: 'server_errors' },
        actions
      },
      actions,
      actionsDisabled: false
    } satisfies DoctorController['viewModel']['rows'][number]
    const controller = createController({ viewModel: { rows: [row] } })

    render(
      <Accordion type="single" collapsible defaultValue="doctor-mcp-servers-connected">
        <DoctorCheckAccordionItems controller={controller} />
      </Accordion>
    )

    expect(screen.getByRole('button', { name: 'Restart Filesystem' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'settings.doctor.actions.more' }))
    expect(screen.getByRole('menuitem', { name: 'Restart MCP service' })).toBeVisible()
  })

  it('closes an expanded action menu without dismissing its parent dialog when the trigger is clicked again', async () => {
    const user = userEvent.setup()
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>Error details</DialogTitle>
          <Accordion type="single" collapsible defaultValue="doctor-runtime-claude-login">
            <DoctorCheckAccordionItems controller={createController()} />
          </Accordion>
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

  it('keeps disclosure state and restores the evidence trigger after canceling consent', async () => {
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
    const checkTrigger = screen.getByRole('button', {
      name: /settings\.doctor\.checks\.runtime-claude-login\.title/
    })
    if (checkTrigger.getAttribute('aria-expanded') === 'false') await user.click(checkTrigger)
    const localDetails = screen.getByRole('button', { name: 'settings.doctor.evidence.local_details' })
    expect(localDetails).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('••••••')).toBeInTheDocument()
    const showDetails = screen.getByRole('button', { name: 'settings.doctor.actions.show_details' })
    await user.click(showDetails)

    const confirmation = await screen.findByRole('dialog', { name: 'settings.doctor.confirm_evidence.title' })
    await user.keyboard('{Escape}')

    expect(confirmation).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'System diagnostics' })).toBeVisible()
    expect(localDetails).toHaveAttribute('aria-expanded', 'true')
    expect(showDetails).toHaveFocus()
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

    const checkTrigger = screen.getByRole('button', {
      name: /settings\.doctor\.checks\.runtime-claude-login\.title/
    })
    if (checkTrigger.getAttribute('aria-expanded') === 'false') await user.click(checkTrigger)
    const localDetails = screen.getByRole('button', { name: 'settings.doctor.evidence.local_details' })
    expect(localDetails).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: 'settings.doctor.actions.show_details' }))

    const confirmation = await screen.findByRole('dialog', { name: 'settings.doctor.confirm_evidence.title' })
    await user.click(within(confirmation).getByRole('button', { name: 'settings.doctor.actions.show_details' }))

    expect(localDetails).toHaveAttribute('aria-expanded', 'true')
    const evidence = screen.getByText('private Doctor evidence').closest('dl')
    expect(evidence).toHaveFocus()
  })
})
