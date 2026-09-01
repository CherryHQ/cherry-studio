import { Button, Dialog, DialogContent, DialogTitle, Form, MenuItem, Scrollbar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { ModelSelectorFilter } from '@renderer/components/ModelSelector'
import { useAgentModelDisabled, useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import { useDefaultModel } from '@renderer/hooks/useModel'
import { useProviderById } from '@renderer/hooks/useProvider'
import { isModelVisibleOutsideAgent } from '@renderer/utils/agent/modelVisibility'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { UniqueModelId } from '@shared/data/types/model'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useForm, type UseFormReturn, useFormState, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  resourceDialogCloseButtonClassName,
  resourceDialogHeaderClassName,
  resourceDialogRailItemClassName,
  resourceDialogTitleClassName
} from '../components/EditDialogShared'
import { BasicInfoStep } from './steps/BasicInfoStep'
import { CapabilityStep } from './steps/CapabilityStep'
import { KnowledgeStep } from './steps/KnowledgeStep'
import { SystemPromptStep } from './steps/SystemPromptStep'
import type { ResourceCreateWizardFormValues, ResourceCreateWizardKind, ResourceCreateWizardValues } from './types'

export type { ResourceCreateWizardKind, ResourceCreateWizardValues } from './types'

type ResourceCreateWizardProps = {
  kind: ResourceCreateWizardKind
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: ResourceCreateWizardValues) => Promise<void> | void
  modelFilter?: ModelSelectorFilter
  isSubmitting?: boolean
  /** Seeds the name field when the caller already knows it (e.g. the picker's search query). */
  initialName?: string
}

type StepId = 'basic' | 'system-prompt' | 'knowledge' | 'capability'

/** The avatar a brand-new resource starts with — exported so callers can preview what they'd create. */
export function getResourceCreateDefaultAvatar(kind: ResourceCreateWizardKind) {
  return kind === 'assistant' ? '💬' : '🤖'
}

function getDefaultValues(kind: ResourceCreateWizardKind, initialName = ''): ResourceCreateWizardFormValues {
  return {
    avatar: getResourceCreateDefaultAvatar(kind),
    name: initialName,
    description: '',
    agentType: 'claude-code',
    permissionMode: AGENT_RUNTIME_CAPABILITIES['claude-code'].createDefaults.permissionMode,
    modelId: null,
    prompt: '',
    knowledgeBaseIds: [],
    skillIds: []
  }
}

/**
 * Footer actions — watches `name`/`modelId` in isolation to gate Next/Create.
 * Kept out of the shell so field edits never re-render DialogContent.
 */
function WizardFooter({
  form,
  stepIndex,
  isLast,
  isSubmitting,
  onCancel,
  onBack,
  onNext,
  onCreate
}: {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  stepIndex: number
  isLast: boolean
  isSubmitting: boolean
  onCancel: () => void
  onBack: () => void
  onNext: () => void
  onCreate: () => void
}) {
  const { t } = useTranslation()
  const [name, modelId] = useWatch({ control: form.control, name: ['name', 'modelId'] })
  const submitting = isSubmitting || form.formState.isSubmitting
  const rootError = form.formState.errors.root?.message
  const basicValid = (name?.trim().length ?? 0) > 0 && Boolean(modelId)
  const canProceed = stepIndex !== 0 || basicValid

  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-border-subtle border-t px-6 py-3">
      {rootError ? <span className="mr-auto text-destructive text-xs">{rootError}</span> : null}
      <Button type="button" variant="ghost" disabled={submitting} className="text-muted-foreground" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
      {stepIndex > 0 ? (
        <Button type="button" variant="outline" disabled={submitting} onClick={onBack}>
          {t('library.config.dialogs.create.back')}
        </Button>
      ) : null}
      {isLast ? (
        <Button type="button" loading={submitting} disabled={!basicValid} onClick={onCreate}>
          {t('library.config.dialogs.create.submit')}
        </Button>
      ) : (
        <Button type="button" disabled={!canProceed} onClick={onNext}>
          {t('library.config.dialogs.create.next')}
        </Button>
      )}
    </div>
  )
}

/**
 * Stepped create flow shared by assistant + agent. Steps 1–2 (basic info,
 * System Prompt) are identical across kinds; agents then configure skills before
 * both kinds configure knowledge bases. A left rail tracks step progress
 * (completed and current steps keep their numbers); the right pane swaps the active
 * step's form as the footer drives navigation. One form collects every field
 * and hands the validated payload to `onSubmit`. Replaces the former
 * single-page ResourceCreateDialog.
 *
 * The shell intentionally does NOT subscribe to form values — avatar/footer
 * watching lives in leaf components — so ordinary field edits do not re-render
 * DialogContent. This preserves the ref stability required by the dialog body.
 */
export function ResourceCreateWizard({
  kind,
  open,
  onOpenChange,
  onSubmit,
  modelFilter,
  isSubmitting = false,
  initialName
}: ResourceCreateWizardProps) {
  const { t } = useTranslation()
  const form = useForm<ResourceCreateWizardFormValues>({ defaultValues: getDefaultValues(kind, initialName) })
  const agentType = form.watch('agentType')
  const agentModelFilter = useAgentModelFilter(kind === 'agent' ? agentType : undefined)
  const isAgentModelDisabled = useAgentModelDisabled()
  const assistantModelFilter = useCallback<ModelSelectorFilter>(
    (model, provider) => isModelVisibleOutsideAgent(model) && (modelFilter?.(model, provider) ?? true),
    [modelFilter]
  )
  const activeModelFilter = kind === 'agent' ? agentModelFilter : assistantModelFilter
  const activeIsModelDisabled = kind === 'agent' ? isAgentModelDisabled : undefined
  const { defaultModel } = useDefaultModel({ enabled: open })
  const { provider: defaultModelProvider } = useProviderById(open ? defaultModel?.providerId : undefined)
  const selectableDefaultModelId =
    open &&
    defaultModel?.isEnabled &&
    defaultModelProvider?.isEnabled &&
    (!activeModelFilter || activeModelFilter(defaultModel, defaultModelProvider))
      ? defaultModel.id
      : null
  const autoSelectedDefaultModelIdRef = useRef<UniqueModelId | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [dialogContentElement, setDialogContentElement] = useState<HTMLDivElement | null>(null)
  const [dialogKey, setDialogKey] = useState(0)
  const pendingCloseActionRef = useRef<(() => void) | null>(null)

  // Combine the parent's async-submit flag with RHF's own isSubmitting so close
  // protection (overlay / Esc / X / knowledge-page navigation) stays locked for the
  // entire submit, not just the window after the parent renders its loading state —
  // otherwise a failure would write its error into an already-closed form. Subscribing
  // to isSubmitting (not form values) keeps the shell off the field-edit re-render path.
  const { isSubmitting: isFormSubmitting } = useFormState({ control: form.control })
  const submitting = isSubmitting || isFormSubmitting

  const steps = useMemo<{ id: StepId; label: string }[]>(() => {
    const basic = { id: 'basic' as const, label: t('library.config.dialogs.create.step.basic') }
    const systemPrompt = { id: 'system-prompt' as const, label: t('library.config.prompt.label') }
    const knowledge = { id: 'knowledge' as const, label: t('library.config.dialogs.create.step.knowledge') }
    if (kind === 'assistant') return [basic, systemPrompt, knowledge]

    const capability = { id: 'capability' as const, label: t('library.config.dialogs.create.step.capability') }
    const caps = AGENT_RUNTIME_CAPABILITIES[agentType]
    return [basic, systemPrompt, ...(caps.skills ? [capability] : []), ...(caps.knowledgeBases ? [knowledge] : [])]
  }, [agentType, kind, t])

  useEffect(() => {
    setStepIndex((index) => Math.min(index, steps.length - 1))
  }, [steps.length])

  // `initialName` seeds the form on open only. Reading it through an effect event keeps it out of the
  // deps, so a caller that passes a still-live value (a search box's query, say) cannot reset a form the
  // user is already filling in — the shared wizard has five callers and a comment would not hold them.
  const resetForOpen = useEffectEvent(() => {
    autoSelectedDefaultModelIdRef.current = null
    form.reset(getDefaultValues(kind, initialName))
    form.clearErrors()
    setStepIndex(0)
  })

  useEffect(() => {
    if (!open) return
    resetForOpen()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `useEffectEvent` reads the latest initialName; this effect is keyed by the open transition.
  }, [kind, open])

  // Preference/model/provider hydration may finish after the dialog opens. Seed only an
  // empty field, and retract only a value that this effect auto-selected if it
  // later falls outside the active model filter.
  useEffect(() => {
    if (!open) {
      autoSelectedDefaultModelIdRef.current = null
      return
    }

    const currentModelId = form.getValues('modelId')
    const autoSelectedModelId = autoSelectedDefaultModelIdRef.current
    if (
      autoSelectedModelId &&
      currentModelId === autoSelectedModelId &&
      selectableDefaultModelId !== autoSelectedModelId
    ) {
      autoSelectedDefaultModelIdRef.current = null
      form.setValue('modelId', null, { shouldDirty: false, shouldTouch: false })
      return
    }

    if (currentModelId || !selectableDefaultModelId) {
      if (autoSelectedModelId && currentModelId !== autoSelectedModelId) {
        autoSelectedDefaultModelIdRef.current = null
      }
      return
    }

    autoSelectedDefaultModelIdRef.current = selectableDefaultModelId
    form.setValue('modelId', selectableDefaultModelId, { shouldDirty: false, shouldTouch: false })
  }, [agentType, form, kind, open, selectableDefaultModelId])

  const isLast = stepIndex === steps.length - 1

  const goNext = () => {
    if (stepIndex === 0) {
      const { name, modelId } = form.getValues()
      if (!(name.trim().length > 0 && modelId)) return
    }
    setStepIndex((index) => Math.min(index + 1, steps.length - 1))
  }
  const goBack = () => setStepIndex((index) => Math.max(index - 1, 0))

  const runPendingCloseAction = useCallback(() => {
    const action = pendingCloseActionRef.current
    if (!action) return

    pendingCloseActionRef.current = null
    action()
  }, [])
  const closeBeforeAction = useCallback(
    (action: () => void) => {
      pendingCloseActionRef.current = action
      if (!open) {
        setDialogKey((key) => key + 1)
        runPendingCloseAction()
        return
      }

      setDialogKey((key) => key + 1)
      onOpenChange(false)
    },
    [onOpenChange, open, runPendingCloseAction]
  )

  useEffect(() => {
    if (open) {
      return undefined
    }

    const frameId = window.requestAnimationFrame(runPendingCloseAction)
    return () => window.cancelAnimationFrame(frameId)
  }, [open, runPendingCloseAction])

  const handleCreate = form.handleSubmit(async (values) => {
    if (!values.modelId) return
    form.clearErrors('root')
    try {
      await onSubmit({
        avatar: values.avatar,
        agentType: values.agentType,
        permissionMode: values.permissionMode,
        name: values.name.trim(),
        modelId: values.modelId,
        description: values.description.trim(),
        prompt: values.prompt.trim(),
        knowledgeBaseIds: values.knowledgeBaseIds,
        skillIds: values.skillIds
      })
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : t('library.config.dialogs.create.submit_failed')
      form.setError('root', { message })
    }
  })

  const title = t(
    kind === 'assistant' ? 'library.config.dialogs.create.assistant_title' : 'library.config.dialogs.create.agent_title'
  )
  const currentStep = steps[Math.min(stepIndex, steps.length - 1)]

  return (
    <Dialog key={dialogKey} open={open} onOpenChange={(nextOpen) => !submitting && onOpenChange(nextOpen)}>
      <DialogContent
        ref={setDialogContentElement}
        closeOnOverlayClick={!submitting}
        size="xl"
        className={cn('flex h-[min(600px,76vh)] flex-col gap-0 p-0', resourceDialogCloseButtonClassName)}
        onPointerDownOutside={(event) => submitting && event.preventDefault()}>
        {/* Header — title */}
        <div className={resourceDialogHeaderClassName}>
          <div className="min-w-0">
            <DialogTitle className={resourceDialogTitleClassName}>{title}</DialogTitle>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={(event) => event.preventDefault()} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1">
              {/* Step rail */}
              <ol className="w-48 shrink-0 space-y-1 border-border border-r-[0.5px] bg-background-subtle p-3">
                {steps.map((step, index) => {
                  const active = index === stepIndex
                  const done = index < stepIndex
                  return (
                    <li key={step.id}>
                      <MenuItem
                        icon={
                          <span
                            className={cn(
                              'flex size-5 shrink-0 items-center justify-center rounded-full font-medium text-[11px]',
                              active
                                ? 'bg-foreground text-background'
                                : done
                                  ? 'bg-foreground/10 text-foreground'
                                  : 'border border-border text-muted-foreground'
                            )}>
                            {index + 1}
                          </span>
                        }
                        label={step.label}
                        active={active}
                        disabled={!done}
                        onClick={() => done && setStepIndex(index)}
                        aria-current={active ? 'step' : undefined}
                        className={cn(resourceDialogRailItemClassName, 'disabled:opacity-100')}
                      />
                    </li>
                  )
                })}
              </ol>

              {/* Active step */}
              <Scrollbar className="min-w-0 flex-1 px-6 py-5">
                {currentStep.id === 'basic' ? (
                  <BasicInfoStep
                    form={form}
                    portalContainer={dialogContentElement}
                    fallbackAvatar={getResourceCreateDefaultAvatar(kind)}
                    modelFilter={activeModelFilter}
                    isModelDisabled={activeIsModelDisabled}
                    runtimeSelectable={kind === 'agent'}
                    onSettingsNavigate={closeBeforeAction}
                  />
                ) : null}
                {currentStep.id === 'system-prompt' ? (
                  <SystemPromptStep form={form} portalContainer={dialogContentElement} />
                ) : null}
                {currentStep.id === 'knowledge' ? (
                  <KnowledgeStep form={form} isSubmitting={submitting} portalContainer={dialogContentElement} />
                ) : null}
                {currentStep.id === 'capability' ? (
                  <CapabilityStep form={form} portalContainer={dialogContentElement} />
                ) : null}
              </Scrollbar>
            </div>

            <WizardFooter
              form={form}
              stepIndex={stepIndex}
              isLast={isLast}
              isSubmitting={isSubmitting}
              onCancel={() => onOpenChange(false)}
              onBack={goBack}
              onNext={goNext}
              onCreate={() => void handleCreate()}
            />
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
