import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useModels } from '@renderer/hooks/useModels'
import type { CreateKnowledgeBaseInput, KnowledgeSelectOption } from '@renderer/pages/knowledge.v2/types'
import type { Group } from '@shared/data/types/group'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { isUniqueModelId, MODEL_CAPABILITY, parseUniqueModelId } from '@shared/data/types/model'
import type { FormEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface CreateKnowledgeBaseDialogProps {
  open: boolean
  groups: Group[]
  isCreating: boolean
  createBase: (input: CreateKnowledgeBaseInput) => Promise<KnowledgeBase>
  onOpenChange: (open: boolean) => void
  onCreated: (base: KnowledgeBase) => void
}

const DEFAULT_EMOJI = '📁'
const DEFAULT_DIMENSIONS = '1536'
const UNGROUPED_GROUP_VALUE = '__ungrouped__'
const KNOWLEDGE_BASE_EMOJIS = ['📁', '📚', '🧠', '💡', '📝', '🔖', '🧪', '🌐', '⭐'] as const

type CreateKnowledgeBaseFormValues = Omit<CreateKnowledgeBaseInput, 'dimensions'>

const createInitialInput = (): CreateKnowledgeBaseFormValues => ({
  name: '',
  emoji: DEFAULT_EMOJI,
  embeddingModelId: null
})

const formatModelOptionLabel = (uniqueModelId: string) => {
  if (!isUniqueModelId(uniqueModelId)) {
    return uniqueModelId
  }

  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  return `${modelId} · ${providerId}`
}

const CreateKnowledgeBaseDialogHeader = ({ title }: { title: string }) => {
  return (
    <DialogHeader className="gap-0.5 border-border/40 border-b px-4 py-3 text-left">
      <DialogTitle className="font-medium text-xs leading-4">{title}</DialogTitle>
    </DialogHeader>
  )
}

const CreateKnowledgeBaseDialogForm = ({
  children,
  onSubmit
}: {
  children: ReactNode
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) => {
  return (
    <form onSubmit={onSubmit} className="flex flex-col">
      {children}
    </form>
  )
}

const CreateKnowledgeBaseDialogEmojiPicker = ({
  emojis,
  value,
  onChange
}: {
  emojis: readonly string[]
  value: string
  onChange: (value: string) => void
}) => {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {emojis.map((emoji) => {
        const selected = emoji === value

        return (
          <button
            key={emoji}
            type="button"
            aria-label={emoji}
            aria-pressed={selected}
            className={cn(
              'flex h-8 w-full items-center justify-center rounded-lg border border-border/50 bg-muted/10 text-sm transition-[background-color,border-color,box-shadow]',
              selected
                ? 'border-foreground/20 bg-accent/80 text-foreground ring-1 ring-foreground/15'
                : 'hover:bg-accent/50'
            )}
            onClick={() => onChange(emoji)}>
            <span aria-hidden="true">{emoji}</span>
          </button>
        )
      })}
    </div>
  )
}

const CreateKnowledgeBaseDialogActions = ({
  isCreating,
  onCancel,
  submitLabel,
  cancelLabel
}: {
  isCreating: boolean
  onCancel: () => void
  submitLabel: string
  cancelLabel: string
}) => {
  return (
    <DialogFooter className="gap-2 border-border/40 border-t px-4 py-3 sm:justify-end">
      <Button
        type="button"
        variant="outline"
        className="h-8 rounded-lg px-3 font-medium text-[11px]"
        onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button type="submit" loading={isCreating} className="h-8 rounded-lg px-3 font-medium text-[11px]">
        {submitLabel}
      </Button>
    </DialogFooter>
  )
}

const CreateKnowledgeBaseDialogRoot = ({
  open,
  groups,
  isCreating,
  createBase,
  onOpenChange,
  onCreated
}: CreateKnowledgeBaseDialogProps) => {
  const { t } = useTranslation()
  const { models: embeddingModels } = useModels({
    capability: MODEL_CAPABILITY.EMBEDDING,
    enabled: true
  })
  const [values, setValues] = useState<CreateKnowledgeBaseFormValues>(() => createInitialInput())
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setValues(createInitialInput())
      setHasAttemptedSubmit(false)
      setSubmitError(null)
    }
  }, [open])

  const embeddingModelOptions: KnowledgeSelectOption[] = embeddingModels.map((model) => ({
    value: model.id,
    label: formatModelOptionLabel(model.id)
  }))

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    setSubmitError(null)

    if (!values.name.trim() || !values.embeddingModelId) {
      return
    }

    // TODO: Resolve dimensions from the selected embedding model before creating the knowledge base.
    const createInput: CreateKnowledgeBaseInput = {
      name: values.name,
      emoji: values.emoji,
      embeddingModelId: values.embeddingModelId,
      dimensions: DEFAULT_DIMENSIONS
    }

    if (values.groupId) {
      createInput.groupId = values.groupId
    }

    let createdBase: KnowledgeBase

    try {
      createdBase = await createBase(createInput)
    } catch {
      setSubmitError(t('knowledge_v2.error.failed_to_create'))
      return
    }

    onCreated(createdBase)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden rounded-2xl border-border/60 p-0">
        <CreateKnowledgeBaseDialog.Header title={t('knowledge_v2.add.title')} />

        <CreateKnowledgeBaseDialog.Form onSubmit={handleSubmit}>
          <div className="space-y-3 px-4 py-3">
            <div className="space-y-1">
              <Label
                htmlFor="knowledge-v2-create-name"
                className="font-medium text-[11px] text-muted-foreground leading-4">
                {t('common.name')}
              </Label>
              <Input
                id="knowledge-v2-create-name"
                value={values.name}
                aria-invalid={hasAttemptedSubmit && !values.name.trim()}
                placeholder={t('common.name')}
                className="h-8 rounded-lg px-2.5 text-[11px] leading-4 placeholder:text-[11px] placeholder:text-muted-foreground/70"
                onChange={(event) => setValues((currentValues) => ({ ...currentValues, name: event.target.value }))}
              />
              {hasAttemptedSubmit && !values.name.trim() ? (
                <FieldError className="text-[11px] leading-4">{t('knowledge_v2.name_required')}</FieldError>
              ) : null}
            </div>

            <div className="space-y-1">
              <Label className="font-medium text-[11px] text-muted-foreground leading-4">
                {t('knowledge_v2.add.icon')}
              </Label>
              <CreateKnowledgeBaseDialog.EmojiPicker
                emojis={KNOWLEDGE_BASE_EMOJIS}
                value={values.emoji}
                onChange={(emoji) => setValues((currentValues) => ({ ...currentValues, emoji }))}
              />
            </div>

            <div className="space-y-1">
              <Label className="font-medium text-[11px] text-muted-foreground leading-4">
                {t('knowledge_v2.add.group')}
              </Label>
              <Select
                value={values.groupId ?? UNGROUPED_GROUP_VALUE}
                onValueChange={(groupValue) =>
                  setValues((currentValues) => ({
                    ...currentValues,
                    groupId: groupValue === UNGROUPED_GROUP_VALUE ? undefined : groupValue
                  }))
                }>
                <SelectTrigger
                  size="sm"
                  className="h-8 w-full rounded-lg px-2.5 text-[11px] leading-4 data-[placeholder]:text-[11px] data-[placeholder]:text-muted-foreground/70">
                  <SelectValue placeholder={t('knowledge_v2.groups.ungrouped')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNGROUPED_GROUP_VALUE}>{t('knowledge_v2.groups.ungrouped')}</SelectItem>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="font-medium text-[11px] text-muted-foreground leading-4">
                {t('knowledge_v2.embedding_model')}
              </Label>
              <Select
                value={values.embeddingModelId ?? undefined}
                onValueChange={(embeddingModelId) =>
                  setValues((currentValues) => ({ ...currentValues, embeddingModelId }))
                }>
                <SelectTrigger
                  size="sm"
                  className="h-8 w-full rounded-lg px-2.5 text-[11px] leading-4 data-[placeholder]:text-[11px] data-[placeholder]:text-muted-foreground/70"
                  aria-invalid={hasAttemptedSubmit && !values.embeddingModelId}>
                  <SelectValue placeholder={t('knowledge_v2.not_set')} />
                </SelectTrigger>
                <SelectContent>
                  {embeddingModelOptions.length > 0 ? (
                    embeddingModelOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))
                  ) : (
                    <div className="px-2.5 py-2 text-[11px] text-muted-foreground">{t('knowledge_v2.not_set')}</div>
                  )}
                </SelectContent>
              </Select>
              {hasAttemptedSubmit && !values.embeddingModelId ? (
                <FieldError className="text-[11px] leading-4">{t('knowledge_v2.embedding_model_required')}</FieldError>
              ) : null}
            </div>

            {submitError ? <FieldError className="text-[11px] leading-4">{submitError}</FieldError> : null}
          </div>

          <CreateKnowledgeBaseDialog.Actions
            isCreating={isCreating}
            onCancel={() => onOpenChange(false)}
            cancelLabel={t('common.cancel')}
            submitLabel={t('knowledge_v2.add.submit')}
          />
        </CreateKnowledgeBaseDialog.Form>
      </DialogContent>
    </Dialog>
  )
}

export const CreateKnowledgeBaseDialog = Object.assign(CreateKnowledgeBaseDialogRoot, {
  Header: CreateKnowledgeBaseDialogHeader,
  Form: CreateKnowledgeBaseDialogForm,
  EmojiPicker: CreateKnowledgeBaseDialogEmojiPicker,
  Actions: CreateKnowledgeBaseDialogActions
})

export default CreateKnowledgeBaseDialog
