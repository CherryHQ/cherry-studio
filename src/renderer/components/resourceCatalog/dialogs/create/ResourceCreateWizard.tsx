import { Button, Dialog, DialogContent, DialogTitle, Form, Scrollbar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useDefaultModel } from '@renderer/hooks/useModel'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { Check } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm, type UseFormReturn, useFormState, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { BasicInfoStep } from './steps/BasicInfoStep'
import { CapabilityStep } from './steps/CapabilityStep'
import { KnowledgeStep } from './steps/KnowledgeStep'
import { PersonaStep } from './steps/PersonaStep'
import type { ResourceCreateWizardFormValues, ResourceCreateWizardKind, ResourceCreateWizardValues } from './types'

export type { ResourceCreateWizardKind, ResourceCreateWizardValues } from './types'

type ResourceCreateWizardProps = {
  kind: ResourceCreateWizardKind
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: ResourceCreateWizardValues) => Promise<void> | void
  modelFilter?: (model: Model) => boolean
  isSubmitting?: boolean
}

type StepId = 'basic' | 'persona' | 'knowledge' | 'capability'

function getDefaultAvatar(kind: ResourceCreateWizardKind) {
  return kind === 'assistant' ? '💬' : '🤖'
}

function getDefaultValues(kind: ResourceCreateWizardKind): ResourceCreateWizardFormValues {
  return {
    avatar: getDefaultAvatar(kind),
    name: '',
    description: '',
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
    <div className="flex shrink-0 items-center justify-end gap-2 border-border-muted border-t px-6 py-3">
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
 * persona) are identical across kinds; step 3 differs (knowledge base vs.
 * capability config). A left rail tracks step progress (done = check, current =
 * filled number); the right pane swaps the active step's form as the footer
 * drives navigation. One form collects every field and hands the validated
 * payload to `onSubmit`. Replaces the former single-page ResourceCreateDialog.
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
  isSubmitting = false
}: ResourceCreateWizardProps) {
  const { t } = useTranslation()
  const form = useForm<ResourceCreateWizardFormValues>({ defaultValues: getDefaultValues(kind) })
  const { defaultModel } = useDefaultModel()
  const selectableDefaultModelId =
    open && defaultModel && (!modelFilter || modelFilter(defaultModel)) ? defaultModel.id : null
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
    const persona = { id: 'persona' as const, label: t('library.config.dialogs.create.step.persona') }
    const last =
      kind === 'assistant'
        ? { id: 'knowledge' as const, label: t('library.config.dialogs.create.step.knowledge') }
        : { id: 'capability' as const, label: t('library.config.dialogs.create.step.capability') }
    return [basic, persona, last]
  }, [kind, t])

  useEffect(() => {
    if (!open) return
    autoSelectedDefaultModelIdRef.current = null
    form.reset(getDefaultValues(kind))
    form.clearErrors()
    setStepIndex(0)
  }, [form, kind, open])

  // Preference/model hydration may finish after the dialog opens. Seed only an
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
  }, [form, kind, open, selectableDefaultModelId])

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
  const currentStep = steps[stepIndex]

  return (
    <Dialog key={dialogKey} open={open} onOpenChange={(nextOpen) => !submitting && onOpenChange(nextOpen)}>
      <DialogContent
        ref={setDialogContentElement}
        closeOnOverlayClick={!submitting}
        size="xl"
        className="flex h-[min(600px,76vh)] flex-col gap-0 p-0"
        onPointerDownOutside={(event) => submitting && event.preventDefault()}>
        {/* Header — title */}
        <div className="flex shrink-0 items-center gap-3 border-border-muted border-b px-6 py-3 pr-12">
          <div className="min-w-0">
            <DialogTitle className="truncate text-base">{title}</DialogTitle>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={(event) => event.preventDefault()} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1">
              {/* Step rail */}
              <ol className="w-44 shrink-0 space-y-1 border-border-muted border-r p-3">
                {steps.map((step, index) => {
                  const done = index < stepIndex
                  const active = index === stepIndex
                  const clickable = index < stepIndex
                  return (
                    <li key={step.id}>
                      <button
                        type="button"
                        disabled={!clickable}
                        onClick={() => clickable && setStepIndex(index)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                          active && 'bg-accent/60',
                          clickable ? 'cursor-pointer hover:bg-accent/40' : 'cursor-default'
                        )}>
                        <span
                          className={cn(
                            'flex size-6 shrink-0 items-center justify-center rounded-full font-medium text-xs',
                            active
                              ? 'bg-foreground text-background'
                              : done
                                ? 'bg-foreground/10 text-foreground'
                                : 'border border-border text-muted-foreground'
                          )}>
                          {done ? <Check size={13} strokeWidth={2.5} /> : index + 1}
                        </span>
                        <span
                          className={cn(
                            'min-w-0 flex-1 truncate text-sm',
                            active ? 'font-medium text-foreground' : 'text-muted-foreground'
                          )}>
                          {step.label}
                        </span>
                      </button>
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
                    fallbackAvatar={getDefaultAvatar(kind)}
                    modelFilter={modelFilter}
                    onSettingsNavigate={closeBeforeAction}
                  />
                ) : null}
                {currentStep.id === 'persona' ? (
                  <PersonaStep form={form} portalContainer={dialogContentElement} />
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
