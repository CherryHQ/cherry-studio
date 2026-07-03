import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  EmojiAvatar,
  Form,
  Scrollbar
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { Model } from '@shared/data/types/model'
import { Check } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { type Control, useForm, type UseFormReturn, useFormState, useWatch } from 'react-hook-form'
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
 * Header avatar — watches `avatar` in isolation so emoji changes re-render only
 * this leaf, never the dialog shell.
 */
function HeaderAvatar({ control, fallback }: { control: Control<ResourceCreateWizardFormValues>; fallback: string }) {
  const avatar = useWatch({ control, name: 'avatar' })
  return (
    <EmojiAvatar size={40} className="shrink-0 cursor-default hover:opacity-100">
      {avatar || fallback}
    </EmojiAvatar>
  )
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
  const [stepIndex, setStepIndex] = useState(0)
  const [dialogContentElement, setDialogContentElement] = useState<HTMLDivElement | null>(null)

  // Combine the parent's async-submit flag with RHF's own isSubmitting so close
  // protection (overlay / Esc / X) stays locked for the entire submit, not just the
  // window after the parent renders its loading state — otherwise a failure would write
  // its error into an already-closed form. Subscribing to isSubmitting (not form values)
  // keeps the shell off the field-edit re-render path the comment below relies on.
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
    form.reset(getDefaultValues(kind))
    form.clearErrors()
    setStepIndex(0)
  }, [form, kind, open])

  const isLast = stepIndex === steps.length - 1

  const goNext = () => {
    if (stepIndex === 0) {
      const { name, modelId } = form.getValues()
      if (!(name.trim().length > 0 && modelId)) return
    }
    setStepIndex((index) => Math.min(index + 1, steps.length - 1))
  }
  const goBack = () => setStepIndex((index) => Math.max(index - 1, 0))

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
    <Dialog open={open} onOpenChange={(nextOpen) => !submitting && onOpenChange(nextOpen)}>
      <DialogContent
        ref={setDialogContentElement}
        closeOnOverlayClick={!submitting}
        size="xl"
        className="flex h-[min(600px,76vh)] flex-col gap-0 p-0"
        onPointerDownOutside={(event) => submitting && event.preventDefault()}>
        {/* Header — avatar + title + step progress */}
        <div className="flex shrink-0 items-center gap-3 border-border-muted border-b px-6 py-4 pr-12">
          <HeaderAvatar control={form.control} fallback={getDefaultAvatar(kind)} />
          <div className="min-w-0">
            <DialogTitle className="truncate text-base">{title}</DialogTitle>
            <DialogDescription className="truncate text-muted-foreground text-xs">
              {t('library.config.dialogs.create.guided_progress', { current: stepIndex + 1, total: steps.length })}
            </DialogDescription>
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
                  />
                ) : null}
                {currentStep.id === 'persona' ? (
                  <PersonaStep form={form} portalContainer={dialogContentElement} />
                ) : null}
                {currentStep.id === 'knowledge' ? (
                  <KnowledgeStep form={form} portalContainer={dialogContentElement} />
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
