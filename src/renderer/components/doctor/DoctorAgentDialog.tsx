import { Undo2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BeatLoader } from 'react-spinners'

import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { useSharedCacheValue } from '@data/hooks/useCache'
import { DefaultModelSelector } from '@renderer/components/DefaultModelSelector'
import { StaticMarkdown } from '@renderer/components/markdown'
import type { ModelSelectorFilter } from '@renderer/components/ModelSelector'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useDoctorAgent } from '@renderer/hooks/doctor'
import { useModels } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import type { Model } from '@shared/data/types/model'
import type { DoctorSubjectRef } from '@shared/types/doctor'
import type {
  DoctorAgentChange,
  DoctorAgentProposal,
  DoctorAgentProposalStatus,
  DoctorAgentWrite
} from '@shared/types/doctorAgent'
import { doctorCheckTitleKey, doctorScopeKey, doctorStateCacheKey } from '@shared/utils/doctor'
import { isGatewayRoutableModel } from '@shared/utils/model'

const PROPOSAL_STATUS_KEYS = {
  pending: 'settings.doctor.agent.proposal_status.pending',
  applied: 'settings.doctor.agent.proposal_status.applied',
  failed: 'settings.doctor.agent.proposal_status.failed',
  rejected: 'settings.doctor.agent.proposal_status.rejected'
} as const satisfies Record<DoctorAgentProposalStatus, string>

interface DoctorAgentDialogProps {
  readonly subject: DoctorSubjectRef
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onReportProblem?: () => void
}

/**
 * The "AI consultation" flow: pick a model, run one headless doctor turn over the report the panel
 * shows, then apply or undo what it proposed. Reopening shows the last analysis for this scope.
 */
export function DoctorAgentDialog({ subject, open, onOpenChange, onReportProblem }: DoctorAgentDialogProps) {
  const { t } = useTranslation()
  const scope = doctorScopeKey(subject)
  const doctorState = useSharedCacheValue(doctorStateCacheKey(scope))
  const reportRunId = doctorState?.status === 'completed' ? doctorState.report.runId : undefined
  const agent = useDoctorAgent({ scope, reportRunId })
  const { state } = agent
  const [pickerForced, setPickerForced] = useState(false)
  const showPicker = pickerForced || state.status === 'idle' || agent.isStale
  const { models } = useModels({ enabled: true })
  const modelLabel =
    state.status === 'idle'
      ? ''
      : (models.find((model) => model.id === state.modelId)?.name ?? state.modelId.split('::').pop() ?? state.modelId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" closeLabel={t('common.close')} className="max-h-[calc(100vh-2rem)]">
        <DialogHeader className="pr-8">
          <DialogTitle>{t('settings.doctor.agent.title')}</DialogTitle>
          <DialogDescription>
            {showPicker ? t('settings.doctor.agent.model_picker.description') : t('settings.doctor.agent.description')}
          </DialogDescription>
          {!showPicker ? (
            <p className="text-xs text-muted-foreground">
              {t('settings.doctor.agent.agent_model', { model: modelLabel })}
            </p>
          ) : null}
        </DialogHeader>
        {showPicker ? (
          <ModelPicker
            disabled={!reportRunId || agent.busy?.kind === 'start'}
            loading={agent.busy?.kind === 'start'}
            onCancel={() => (pickerForced ? setPickerForced(false) : onOpenChange(false))}
            onStart={async (modelId) => {
              await agent.start(modelId)
              setPickerForced(false)
            }}
          />
        ) : (
          <Consultation
            agent={agent}
            onDismiss={() => onOpenChange(false)}
            onRestart={() => setPickerForced(true)}
            onReportProblem={onReportProblem}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ModelPicker({
  disabled,
  loading,
  onCancel,
  onStart
}: {
  readonly disabled: boolean
  readonly loading: boolean
  readonly onCancel: () => void
  readonly onStart: (modelId: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [defaultModelId] = usePreference('chat.default_model_id')
  const { providers } = useProviders({ enabled: true })
  const { models } = useModels({ enabled: true })
  const [selected, setSelected] = useState<Model | undefined>(undefined)
  const model = selected ?? models.find((candidate) => candidate.id === defaultModelId)
  const filter = useCallback<ModelSelectorFilter>(
    (candidate, provider) => provider?.isEnabled !== false && isGatewayRoutableModel(candidate),
    []
  )

  return (
    <>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t('settings.doctor.agent.model_picker.title')}</h3>
        <DefaultModelSelector
          model={model}
          providers={providers}
          filter={filter}
          onSelect={setSelected}
          placeholder={t('settings.doctor.agent.model_picker.empty')}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="emphasis"
          disabled={disabled || !model}
          loading={loading}
          onClick={() => model && void onStart(model.id)}>
          {t('settings.doctor.agent.actions.start')}
        </Button>
      </DialogFooter>
    </>
  )
}

function Consultation({
  agent,
  onDismiss,
  onRestart,
  onReportProblem
}: {
  readonly agent: ReturnType<typeof useDoctorAgent>
  readonly onDismiss: () => void
  readonly onRestart: () => void
  readonly onReportProblem?: () => void
}) {
  const { t } = useTranslation()
  const { state } = agent
  if (state.status === 'idle') return null
  const running = state.status === 'running'

  return (
    <>
      <div className="max-h-[55vh] space-y-3 overflow-y-auto rounded-xl border border-border bg-background p-4 text-sm">
        {running ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
            <BeatLoader color="currentColor" size={4} speedMultiplier={0.8} />
            <span>
              {state.toolCalls.length > 0
                ? t('settings.doctor.agent.running_tool', { tool: state.toolCalls.at(-1) })
                : t('settings.doctor.agent.running')}
            </span>
          </div>
        ) : null}
        {state.status === 'failed' ? <Alert type="error" showIcon description={state.error} /> : null}
        {state.status === 'canceled' ? (
          <Alert type="warning" showIcon description={t('settings.doctor.agent.canceled')} />
        ) : null}
        {state.text ? <StaticMarkdown id={`doctor-agent-${state.runId}`}>{state.text}</StaticMarkdown> : null}

        {state.proposals.length > 0 ? (
          <section className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground">{t('settings.doctor.agent.proposals')}</h4>
            <ul className="space-y-2">
              {state.proposals.map((proposal) => (
                <ProposalRow
                  key={proposal.id}
                  proposal={proposal}
                  disabled={running}
                  loading={agent.busy?.kind === 'apply' && agent.busy.id === proposal.id}
                  onApply={() => void agent.apply(proposal.id)}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {state.changes.length > 0 ? (
          <section className="space-y-2">
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
          </section>
        ) : null}
      </div>
      <DialogFooter>
        {running ? (
          <Button variant="outline" loading={agent.busy?.kind === 'cancel'} onClick={() => void agent.cancel()}>
            {t('settings.doctor.agent.actions.cancel')}
          </Button>
        ) : (
          <>
            {onReportProblem ? (
              <Button variant="outline" onClick={onReportProblem}>
                {t('settings.doctor.actions.report_problem')}
              </Button>
            ) : null}
            <Button variant="outline" onClick={onRestart}>
              {t('settings.doctor.agent.actions.restart')}
            </Button>
            <Button variant="ghost" onClick={onDismiss}>
              {t('settings.doctor.agent.actions.dismiss')}
            </Button>
          </>
        )}
      </DialogFooter>
    </>
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
