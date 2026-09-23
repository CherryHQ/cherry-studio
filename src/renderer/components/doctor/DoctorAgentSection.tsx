import { Loader2, Sparkles, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button, Checkbox } from '@cherrystudio/ui'
import { StaticMarkdown } from '@renderer/components/markdown'
import { type DoctorController, useDoctorAgent } from '@renderer/hooks/doctor'
import type {
  DoctorAgentChange,
  DoctorAgentProposal,
  DoctorAgentProposalStatus,
  DoctorAgentWrite
} from '@shared/types/doctorAgent'
import { doctorCheckTitleKey } from '@shared/utils/doctor'

const PROPOSAL_STATUS_KEYS = {
  pending: 'settings.doctor.agent.proposal_status.pending',
  applied: 'settings.doctor.agent.proposal_status.applied',
  failed: 'settings.doctor.agent.proposal_status.failed',
  rejected: 'settings.doctor.agent.proposal_status.rejected'
} as const satisfies Record<DoctorAgentProposalStatus, string>

type DoctorAgentSectionController = Pick<DoctorController, 'scope'> & {
  readonly viewModel: Pick<DoctorController['viewModel'], 'report' | 'status'>
}

export function DoctorAgentSection({ controller }: { readonly controller: DoctorAgentSectionController }) {
  const { t } = useTranslation()
  const report = controller.viewModel.report
  const agent = useDoctorAgent({ scope: controller.scope, reportRunId: report?.runId })
  const [consented, setConsented] = useState(false)
  const { state } = agent
  const canStart =
    controller.viewModel.status === 'completed' && report !== undefined && state.status !== 'running' && consented

  return (
    <section
      aria-label={t('settings.doctor.agent.title')}
      className="space-y-3 rounded-xl border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4" aria-hidden />
            {t('settings.doctor.agent.title')}
          </h3>
          <p className="text-xs text-muted-foreground">{t('settings.doctor.agent.description')}</p>
        </div>
        {state.status === 'running' ? (
          <Button
            variant="outline"
            size="sm"
            loading={agent.busy?.kind === 'cancel'}
            onClick={() => void agent.cancel()}>
            {t('settings.doctor.agent.actions.cancel')}
          </Button>
        ) : (
          <Button
            variant="emphasis"
            size="sm"
            disabled={!canStart}
            loading={agent.busy?.kind === 'start'}
            onClick={() => void agent.start()}>
            {t(
              state.status === 'idle' ? 'settings.doctor.agent.actions.start' : 'settings.doctor.agent.actions.restart'
            )}
          </Button>
        )}
      </div>

      {state.status !== 'running' ? (
        <label className="flex cursor-pointer items-start gap-2 text-xs" htmlFor="doctor-agent-consent">
          <Checkbox
            id="doctor-agent-consent"
            checked={consented}
            onCheckedChange={(checked) => setConsented(checked === true)}
          />
          <span>{t('settings.doctor.agent.consent')}</span>
        </label>
      ) : null}

      {agent.isStale ? <Alert type="warning" showIcon description={t('settings.doctor.agent.stale')} /> : null}
      {state.status === 'failed' ? <Alert type="error" showIcon description={state.error} /> : null}

      {state.status === 'running' ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          <span>
            {state.toolCalls.length > 0
              ? t('settings.doctor.agent.running_tool', { tool: state.toolCalls.at(-1) })
              : t('settings.doctor.agent.running')}
          </span>
        </div>
      ) : null}

      {state.status !== 'idle' && state.text ? (
        <div className="text-sm">
          <StaticMarkdown id={`doctor-agent-${state.runId}`}>{state.text}</StaticMarkdown>
        </div>
      ) : null}

      {state.status !== 'idle' && state.proposals.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">{t('settings.doctor.agent.proposals')}</h4>
          <ul className="space-y-2">
            {state.proposals.map((proposal) => (
              <ProposalRow
                key={proposal.id}
                proposal={proposal}
                disabled={agent.isStale || state.status === 'running'}
                loading={agent.busy?.kind === 'apply' && agent.busy.id === proposal.id}
                onApply={() => void agent.apply(proposal.id)}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {state.status !== 'idle' && state.changes.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">{t('settings.doctor.agent.changes')}</h4>
          <ul className="space-y-2">
            {state.changes.map((change) => (
              <ChangeRow
                key={change.id}
                change={change}
                loading={agent.busy?.kind === 'undo' && agent.busy.id === change.id}
                onUndo={() => void agent.undo(change.id)}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function ProposalRow({
  proposal,
  disabled,
  loading,
  onApply
}: {
  readonly proposal: DoctorAgentProposal
  readonly disabled: boolean
  readonly loading: boolean
  readonly onApply: () => void
}) {
  const { t } = useTranslation()
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-border p-3 text-xs">
      <div className="min-w-0 space-y-1">
        <div className="font-medium">{proposal.summary}</div>
        <div className="text-muted-foreground">
          <WriteLabel write={proposal.write} />
        </div>
        {proposal.error ? <div className="text-destructive">{proposal.error}</div> : null}
      </div>
      {proposal.status === 'pending' ? (
        <Button size="sm" variant="outline" disabled={disabled} loading={loading} onClick={onApply}>
          {t('settings.doctor.agent.actions.apply')}
        </Button>
      ) : (
        <span className="shrink-0 text-muted-foreground">{t(PROPOSAL_STATUS_KEYS[proposal.status])}</span>
      )}
    </li>
  )
}

function ChangeRow({
  change,
  loading,
  onUndo
}: {
  readonly change: DoctorAgentChange
  readonly loading: boolean
  readonly onUndo: () => void
}) {
  const { t } = useTranslation()
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-border p-3 text-xs">
      <div className="min-w-0 space-y-1">
        <div className={change.undone ? 'font-medium line-through' : 'font-medium'}>{change.summary}</div>
        <div className="text-muted-foreground">
          <WriteLabel write={change.write} />
        </div>
      </div>
      {change.undoable && !change.undone ? (
        <Button size="sm" variant="outline" loading={loading} onClick={onUndo}>
          <Undo2 className="size-3.5" aria-hidden />
          {t('settings.doctor.agent.actions.undo')}
        </Button>
      ) : change.undone ? (
        <span className="shrink-0 text-muted-foreground">{t('settings.doctor.agent.change_status.undone')}</span>
      ) : null}
    </li>
  )
}

function WriteLabel({ write }: { readonly write: DoctorAgentWrite }) {
  const { t } = useTranslation()
  switch (write.kind) {
    case 'data_api_patch':
      return (
        <code>
          {t('settings.doctor.agent.write.data_api_patch', {
            path: write.path,
            fields: Object.keys(write.body).join(', ')
          })}
        </code>
      )
    case 'preference_set':
      return (
        <code>
          {t('settings.doctor.agent.write.preference_set', { key: write.key, value: JSON.stringify(write.value) })}
        </code>
      )
    case 'doctor_fix':
      return (
        <span>
          {t('settings.doctor.agent.write.doctor_fix', {
            fix: write.request.fixId,
            check: t(doctorCheckTitleKey(write.request.checkId))
          })}
        </span>
      )
  }
}
