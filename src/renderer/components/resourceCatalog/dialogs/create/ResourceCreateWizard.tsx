import { Sparkles } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useForm, type UseFormReturn, useFormState, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogTitle, Form, MenuItem, ScrollArea } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { type ModelSelectorFilter } from '@renderer/components/ModelSelector'
import { useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import { useIsCherryCloudModelSelectable } from '@renderer/hooks/cherryCloud/useIsCherryCloudModelSelectable'
import { useResourceAutoConfigure } from '@renderer/hooks/resourceCatalog'
import { useDefaultModel, useModels } from '@renderer/hooks/useModel'
import { useProviderById } from '@renderer/hooks/useProvider'
import type { ResourceEditDialogTarget } from '@renderer/types/resourceCatalog'
import { getErrorMessage } from '@renderer/utils/error'
import type { AutoConfigDraft } from '@renderer/utils/resourceCatalog'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { UniqueModelId } from '@shared/data/types/model'

import {
  resourceDialogCloseButtonClassName,
  resourceDialogHeaderClassName,
  resourceDialogRailItemClassName,
  resourceDialogTitleClassName
} from '../components/EditDialogShared'
import { type CreatedResource, ResourceCreateResultView, ResourceCreateWorkingView } from './ResourceCreateResult'
import { AutoCreateEntry } from './steps/AutoCreateEntry'
import { BasicInfoStep } from './steps/BasicInfoStep'
import { CapabilityStep } from './steps/CapabilityStep'
import { KnowledgeStep } from './steps/KnowledgeStep'
import { SystemPromptStep } from './steps/SystemPromptStep'
import type { ResourceCreateWizardFormValues, ResourceCreateWizardKind, ResourceCreateWizardValues } from './types'

export type { ResourceCreateWizardKind, ResourceCreateWizardValues } from './types'

// Lazy so the edit dialog's form deps load only when "Adjust settings" is used.
const ResourceEditDialogHost = lazy(() =>
  import('../edit').then((module) => ({ default: module.ResourceEditDialogHost }))
)

type ResourceCreateWizardProps = {
  kind: ResourceCreateWizardKind
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Creates the resource and resolves to its ID, which the result page acts on. */
  onSubmit: (values: ResourceCreateWizardValues) => Promise<string> | string
  /** The caller's "Start conversation" action; the wizard has already closed when it runs. */
  onStartConversation: (id: string) => void
  modelFilter?: ModelSelectorFilter
  isSubmitting?: boolean
  /** Seeds the name field when the caller already knows it (e.g. the picker's search query). */
  initialName?: string
  initialValues?: Partial<Pick<ResourceCreateWizardFormValues, 'name' | 'description' | 'avatar' | 'prompt'>>
}

type StepId = 'basic' | 'system-prompt' | 'knowledge' | 'capability'
type WizardView = 'entry' | 'steps' | 'working' | 'result'

const AUTO_CREATE_TIMEOUT_MS = 60_000

/** The avatar a brand-new resource starts with — exported so callers can preview what they'd create. */
export function getResourceCreateDefaultAvatar(kind: ResourceCreateWizardKind) {
  return kind === 'assistant' ? '💬' : '✨'
}

function getDefaultValues(
  kind: ResourceCreateWizardKind,
  initialName = '',
  initialValues: ResourceCreateWizardProps['initialValues'] = {}
): ResourceCreateWizardFormValues {
  const agentType = kind === 'agent' ? 'pi-durable' : 'claude-code'
  return {
    avatar: getResourceCreateDefaultAvatar(kind),
    name: initialName,
    description: '',
    agentType,
    permissionMode: AGENT_RUNTIME_CAPABILITIES[agentType].createDefaults.permissionMode,
    modelId: null,
    prompt: '',
    knowledgeBaseIds: [],
    skillIds: [],
    mcpServerIds: [],
    enableWebSearch: false,
    ...initialValues
  }
}

/** Callers that seed a prompt (catalog templates) are already configured, so they skip the entry. */
function getInitialView(initialValues: ResourceCreateWizardProps['initialValues']): WizardView {
  return initialValues?.prompt ? 'steps' : 'entry'
}

/** A name the user typed or an avatar they picked wins over the generated one. */
function applyAutoConfigDraft(
  values: ResourceCreateWizardFormValues,
  draft: AutoConfigDraft,
  avatarPicked: boolean
): Partial<ResourceCreateWizardFormValues> {
  return {
    name: values.name.trim() || draft.name,
    avatar: avatarPicked ? values.avatar : (draft.emoji ?? values.avatar),
    description: draft.description || values.description,
    prompt: draft.prompt,
    knowledgeBaseIds: draft.knowledgeBaseIds,
    mcpServerIds: draft.mcpServerIds,
    skillIds: draft.skillIds,
    enableWebSearch: draft.enableWebSearch,
    ...(draft.permissionMode ? { permissionMode: draft.permissionMode } : {})
  }
}

type GenerateAutoConfig = ReturnType<typeof useResourceAutoConfigure>['generate']

/**
 * Entry footer — gates Auto create on purpose + model and owns the catalog queries, in a leaf
 * so field edits and catalog loads skip the shell, and nothing is fetched while it is closed.
 */
function EntryFooter({
  kind,
  form,
  isSubmitting,
  onManual,
  onAuto
}: {
  kind: ResourceCreateWizardKind
  form: UseFormReturn<ResourceCreateWizardFormValues>
  isSubmitting: boolean
  onManual: () => void
  onAuto: (generate: GenerateAutoConfig) => void
}) {
  const { t } = useTranslation()
  const { ready: catalogsReady, generate } = useResourceAutoConfigure(kind)
  const [purpose, modelId] = useWatch({ control: form.control, name: ['description', 'modelId'] })
  const busy = isSubmitting || form.formState.isSubmitting
  const rootError = form.formState.errors.root?.message
  const canAuto = (purpose?.trim().length ?? 0) > 0 && Boolean(modelId) && catalogsReady

  return (
    <div className="flex shrink-0 items-center justify-end gap-2 px-6 pb-5">
      {rootError ? (
        <span role="alert" className="mr-auto text-destructive text-xs">
          {rootError}
        </span>
      ) : null}
      <Button type="button" variant="outline" disabled={busy} onClick={onManual}>
        {t('library.config.dialogs.create.auto.manual')}
      </Button>
      <Button type="button" variant="emphasis" loading={busy} disabled={!canAuto} onClick={() => onAuto(generate)}>
        {busy ? null : <Sparkles className="size-3.5" />}
        {busy ? t('library.config.dialogs.create.auto.configuring') : t('library.config.dialogs.create.auto.submit')}
      </Button>
    </div>
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
 * Create flow shared by assistant + agent. It opens on an entry view (avatar, name, purpose,
 * model) where Auto create generates the configuration once and submits it, and Manual create
 * continues into the steps; callers that seed a prompt (catalog templates) start on the steps.
 * Every successful create ends on a result page whose actions open the edit dialog or run the
 * caller's `onStartConversation`.
 *
 * In the steps, basic info and System Prompt are identical across kinds; agents then
 * configure skills before both kinds configure knowledge bases. A left rail tracks step progress
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
  onStartConversation,
  modelFilter,
  isSubmitting = false,
  initialName,
  initialValues
}: ResourceCreateWizardProps) {
  const { t } = useTranslation()
  const form = useForm<ResourceCreateWizardFormValues>({
    defaultValues: getDefaultValues(kind, initialName, initialValues)
  })
  const agentType = form.watch('agentType')
  const agentModelFilter = useAgentModelFilter(kind === 'agent' ? agentType : undefined)
  const activeModelFilter = kind === 'agent' ? agentModelFilter : modelFilter
  const isModelSelectable = useIsCherryCloudModelSelectable({ includeAgentOnlyModels: kind === 'agent', enabled: open })
  const { models: availableModels } = useModels({ enabled: true }, { fetchEnabled: open })
  const { defaultModel, isDefaultModelLoading } = useDefaultModel({ enabled: open })
  const { provider: defaultModelProvider } = useProviderById(open ? defaultModel?.providerId : undefined)
  const selectableDefaultModelId =
    open &&
    defaultModel?.isEnabled &&
    availableModels.some((model) => model.id === defaultModel.id) &&
    defaultModelProvider?.isEnabled &&
    (!activeModelFilter || activeModelFilter(defaultModel, defaultModelProvider)) &&
    isModelSelectable(defaultModel)
      ? defaultModel.id
      : null
  const autoSelectedDefaultModelIdRef = useRef<UniqueModelId | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [view, setView] = useState<WizardView>(() => getInitialView(initialValues))
  const [created, setCreated] = useState<CreatedResource | null>(null)
  const [editTarget, setEditTarget] = useState<ResourceEditDialogTarget | null>(null)
  const autoAbortRef = useRef<AbortController | null>(null)
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
    form.reset(getDefaultValues(kind, initialName, initialValues))
    form.clearErrors()
    setStepIndex(0)
    setView(getInitialView(initialValues))
    setCreated(null)
  })

  /** Last `(kind, open)` pair this wizard already initialised for. <Activity> destroys the
   * effects of a hidden tab and re-creates them when the tab is shown again, so a re-show
   * with an unchanged pair must not be treated as a fresh open — that would wipe the draft
   * (name / description / prompt) and jump back to step 1. */
  const lastHandledResetKeyRef = useRef<{ kind: ResourceCreateWizardKind; open: boolean } | null>(null)

  useEffect(() => {
    const previous = lastHandledResetKeyRef.current
    if (previous?.kind === kind && previous.open === open) return

    lastHandledResetKeyRef.current = { kind, open }
    if (!open) return

    resetForOpen()
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

  /** Resolves whether the resource was created; on success the dialog moves to the result page. */
  const submitValues = async (values: ResourceCreateWizardFormValues, generated = false): Promise<boolean> => {
    if (!values.modelId) return false
    form.clearErrors('root')
    const payload: ResourceCreateWizardValues = {
      avatar: values.avatar,
      agentType: values.agentType,
      permissionMode: values.permissionMode,
      name: values.name.trim(),
      modelId: values.modelId,
      description: values.description.trim(),
      prompt: values.prompt.trim(),
      knowledgeBaseIds: values.knowledgeBaseIds,
      skillIds: values.skillIds,
      mcpServerIds: values.mcpServerIds,
      enableWebSearch: values.enableWebSearch
    }
    try {
      const id = await onSubmit(payload)
      setCreated({ id, values: payload, generated })
      setView('result')
      return true
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : t('library.config.dialogs.create.submit_failed')
      form.setError('root', { message })
      return false
    }
  }
  const handleCreate = form.handleSubmit((values) => submitValues(values))

  // Closing (or hiding) the dialog cancels an in-flight generation.
  useEffect(() => () => autoAbortRef.current?.abort(), [open])

  const handleAutoCreate = async (generate: GenerateAutoConfig) => {
    const values = form.getValues()
    if (!values.modelId || !values.description.trim()) return
    if (!defaultModel && !isDefaultModelLoading) {
      form.setError('root', { message: t('library.config.prompt.no_default_model') })
      return
    }
    form.clearErrors('root')

    const controller = new AbortController()
    const timeout = AbortSignal.timeout(AUTO_CREATE_TIMEOUT_MS)
    autoAbortRef.current = controller
    setView('working')
    let draft: AutoConfigDraft | null
    try {
      draft = await generate({
        agentType: values.agentType,
        purpose: values.description,
        name: values.name,
        signal: AbortSignal.any([controller.signal, timeout])
      })
    } catch (error) {
      if (!controller.signal.aborted) {
        form.setError('root', { message: timeout.aborted ? t('error.request_timeout') : getErrorMessage(error) })
      }
      setView('entry')
      return
    } finally {
      if (autoAbortRef.current === controller) autoAbortRef.current = null
    }
    // An abort (close or <Activity> hide) returns to the entry so a re-show is not stuck working.
    if (controller.signal.aborted || !draft) {
      if (!draft) form.setError('root', { message: t('library.config.dialogs.create.auto.failed') })
      setView('entry')
      return
    }

    // Submit the merged values without writing the draft into the form, so a failed create
    // leaves the entry (and the manual path) exactly as the user filled it in.
    const generated = draft
    let createdResource = false
    await form.handleSubmit(async (current) => {
      createdResource = await submitValues(
        {
          ...current,
          ...applyAutoConfigDraft(current, generated, current.avatar !== form.formState.defaultValues?.avatar)
        },
        true
      )
    })()
    if (!createdResource) setView('entry')
  }

  const closeThen = (action: () => void) => {
    onOpenChange(false)
    action()
  }

  const title =
    view === 'working'
      ? t('library.config.dialogs.create.result.working_title')
      : view === 'result'
        ? t(
            kind === 'assistant'
              ? 'library.config.dialogs.create.result.assistant_title'
              : 'library.config.dialogs.create.result.agent_title'
          )
        : t(
            kind === 'assistant'
              ? 'library.config.dialogs.create.assistant_title'
              : 'library.config.dialogs.create.agent_title'
          )
  const currentStep = steps[Math.min(stepIndex, steps.length - 1)]

  return (
    <>
      <Dialog key={dialogKey} open={open} onOpenChange={(nextOpen) => !submitting && onOpenChange(nextOpen)}>
        <DialogContent
          ref={setDialogContentElement}
          closeOnOverlayClick={!submitting}
          size={view === 'steps' ? 'xl' : 'default'}
          className={cn(
            'flex flex-col gap-0 p-0',
            view === 'steps' ? 'h-[min(600px,76vh)]' : 'sm:max-w-[440px]',
            resourceDialogCloseButtonClassName
          )}
          onPointerDownOutside={(event) => submitting && event.preventDefault()}>
          {/* Header — title */}
          <div className={resourceDialogHeaderClassName}>
            <div className="min-w-0">
              <DialogTitle className={resourceDialogTitleClassName}>{title}</DialogTitle>
            </div>
          </div>

          <Form {...form}>
            <form onSubmit={(event) => event.preventDefault()} className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {view === 'entry' ? (
                <>
                  <div className="px-6 pt-6 pb-5">
                    <AutoCreateEntry
                      kind={kind}
                      form={form}
                      portalContainer={dialogContentElement}
                      fallbackAvatar={getResourceCreateDefaultAvatar(kind)}
                      modelFilter={activeModelFilter}
                      includeAgentOnlyModels={kind === 'agent'}
                      disabled={submitting}
                      onSettingsNavigate={closeBeforeAction}
                    />
                  </div>
                  <EntryFooter
                    kind={kind}
                    form={form}
                    isSubmitting={isSubmitting}
                    onManual={() => {
                      form.clearErrors('root')
                      const { description, prompt } = form.getValues()
                      if (kind === 'agent' && !prompt.trim() && description.trim()) {
                        form.setValue('prompt', description.trim(), { shouldDirty: true })
                      }
                      setView('steps')
                    }}
                    onAuto={(generate) => void handleAutoCreate(generate)}
                  />
                </>
              ) : view === 'working' ? (
                <ResourceCreateWorkingView kind={kind} form={form} />
              ) : view === 'result' && created ? (
                <ResourceCreateResultView
                  kind={kind}
                  created={created}
                  onAdjust={() => closeThen(() => setEditTarget({ kind, id: created.id }))}
                  onStart={() => closeThen(() => onStartConversation(created.id))}
                />
              ) : (
                <>
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
                    <ScrollArea
                      contentProps={{ className: cn('px-6 py-5', currentStep.id === 'system-prompt' && 'h-full') }}
                      className="min-w-0 flex-1">
                      {currentStep.id === 'basic' ? (
                        <BasicInfoStep
                          form={form}
                          portalContainer={dialogContentElement}
                          fallbackAvatar={getResourceCreateDefaultAvatar(kind)}
                          modelFilter={activeModelFilter}
                          showAgentFields={kind === 'agent'}
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
                    </ScrollArea>
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
                </>
              )}
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      {/* Outside the Dialog so it outlives the wizard closing. */}
      {editTarget ? (
        <Suspense fallback={null}>
          <ResourceEditDialogHost target={editTarget} onOpenChange={(nextOpen) => !nextOpen && setEditTarget(null)} />
        </Suspense>
      ) : null}
    </>
  )
}
