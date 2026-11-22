import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Checkbox, ConfirmDialog, Textarea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { getErrorMessage } from '@renderer/utils/error'
import type { ModelSwitchHandoffDraft } from '@shared/data/api/schemas/agentSessions'

const logger = loggerService.withContext('ModelSwitchHandoffDialog')

interface ModelSwitchHandoffDialogProps {
  open: boolean
  sessionId?: string
  targetModelId?: string
  modelName: string
  skipConfirmation: boolean
  onSkipConfirmationChange: (skip: boolean) => void
  onOpenChange: (open: boolean) => void
  onConfirm: (handoff?: ModelSwitchHandoffDraft) => Promise<boolean | void>
}

export function ModelSwitchHandoffDialog({
  open,
  sessionId,
  targetModelId,
  modelName,
  skipConfirmation,
  onSkipConfirmationChange,
  onOpenChange,
  onConfirm
}: ModelSwitchHandoffDialogProps) {
  const { t } = useTranslation()
  const id = useId()
  const [enabled, setEnabled] = useState(false)
  const [draft, setDraft] = useState<ModelSwitchHandoffDraft>()
  const [error, setError] = useState<string>()
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const request = useRef<string | undefined>(undefined)

  const cancelGeneration = useCallback(() => {
    const requestId = request.current
    request.current = undefined
    if (requestId)
      void ipcApi.request('ai.text.abort', { requestId }).catch((cause) => {
        logger.warn('Failed to cancel handoff generation', cause as Error)
      })
  }, [])
  useEffect(() => {
    setEnabled(false)
    setDraft(undefined)
    setError(undefined)
    setGenerating(false)
    return cancelGeneration
  }, [open, sessionId, targetModelId, cancelGeneration])

  const generate = async () => {
    if (!sessionId) return
    cancelGeneration()
    const requestId = crypto.randomUUID()
    request.current = requestId
    setGenerating(true)
    setDraft(undefined)
    setError(undefined)
    try {
      const result = await ipcApi.request('ai.agent.session.handoff.generate', { sessionId, requestId })
      if (request.current === requestId) setDraft(result)
    } catch (cause) {
      if (request.current === requestId) setError(getErrorMessage(cause))
    } finally {
      if (request.current === requestId) {
        request.current = undefined
        setGenerating(false)
      }
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next)
      }}
      title={t('agent.session.model_switch_confirm.title', { model: modelName })}
      description={t('agent.session.model_switch_confirm.description')}
      contentClassName="max-h-[90vh] overflow-y-auto"
      content={
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex items-start gap-2">
            <Checkbox
              id={`${id}-handoff`}
              size="sm"
              checked={enabled}
              disabled={saving}
              onCheckedChange={(checked) => {
                setEnabled(checked === true)
                if (checked !== true) {
                  cancelGeneration()
                  setGenerating(false)
                }
              }}
            />
            <label htmlFor={`${id}-handoff`} className="cursor-pointer text-sm text-foreground">
              {t('agent.session.model_switch_confirm.handoff_option')}
            </label>
          </div>
          {enabled && (
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-sm text-muted-foreground">{t('agent.session.model_switch_confirm.handoff_cost')}</p>
              <Button variant="outline" onClick={generate} loading={generating} disabled={generating || saving}>
                {t('agent.session.model_switch_confirm.handoff_generate')}
              </Button>
              {draft && (
                <>
                  <label htmlFor={`${id}-text`} className="text-sm text-foreground">
                    {t('agent.session.model_switch_confirm.handoff_edit')}
                  </label>
                  <Textarea.Input
                    id={`${id}-text`}
                    value={draft.text}
                    rows={10}
                    className="max-h-64 min-h-40 overflow-y-auto"
                    className="max-h-64 min-h-40 overflow-y-auto"
                    disabled={saving}
                    onChange={(event) => setDraft({ ...draft, text: event.target.value })}
                  />
                </>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm break-words text-error">
              {t('agent.session.model_switch_confirm.handoff_error')}: {error}
            </p>
          )}
          <div className="flex items-start gap-2">
            <Checkbox
              id={`${id}-skip`}
              size="sm"
              checked={skipConfirmation}
              disabled={saving}
              onCheckedChange={(checked) => onSkipConfirmationChange(checked === true)}
            />
            <label htmlFor={`${id}-skip`} className="cursor-pointer text-sm text-foreground">
              {t('agent.session.model_switch_confirm.skip_for_app_run')}
            </label>
          </div>
        </div>
      }
      confirmText={t('agent.session.model_switch_confirm.confirm')}
      cancelText={t('common.cancel')}
      confirmDisabled={saving || (enabled && (generating || !draft?.text.trim()))}
      confirmLoading={saving}
      cancelDisabled={saving}
      onConfirm={async () => {
        setSaving(true)
        try {
          return await onConfirm(enabled ? draft : undefined)
        } finally {
          setSaving(false)
        }
      }}
    />
  )
}
