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
import { useModels } from '@renderer/hooks/useModel'
import type { KnowledgeSelectOption } from '@renderer/pages/knowledge/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { Group } from '@shared/data/types/group'
import type { CreateKnowledgeBaseDto, KnowledgeBase, KnowledgeBaseEmoji } from '@shared/data/types/knowledge'
import { isUniqueModelId, MODEL_CAPABILITY, parseUniqueModelId } from '@shared/data/types/model'
import type { FormEvent, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface CreateKnowledgeBaseDialogProps {
  open: boolean
  groups: Group[]
  initialGroupId?: string
  isCreating: boolean
  createBase: (input: CreateKnowledgeBaseInput) => Promise<KnowledgeBase>
  onOpenChange: (open: boolean) => void
  onCreated: (base: KnowledgeBase) => void
}

const DEFAULT_EMOJI: KnowledgeBaseEmoji = '📁'
export const KNOWLEDGE_BASE_DEFAULT_DIMENSIONS = 1024
const KNOWLEDGE_BASE_EMOJIS = [
  '📁',
  '📚',
  '🧠',
  '💡',
  '📝',
  '🔖',
  '🧪',
  '🌐',
  '⭐'
] as const satisfies readonly KnowledgeBaseEmoji[]

type CreateKnowledgeBaseInput = Pick<CreateKnowledgeBaseDto, 'name' | 'groupId' | 'embeddingModelId' | 'dimensions'> & {
  emoji: KnowledgeBaseEmoji
}
type CreateKnowledgeBaseFormValues = Omit<CreateKnowledgeBaseInput, 'dimensions' | 'embeddingModelId'> & {
  embeddingModelId: string | null
}

const createInitialInput = (groupId?: string): CreateKnowledgeBaseFormValues => ({
  name: '',
  emoji: DEFAULT_EMOJI,
  groupId,
  embeddingModelId: null
})

export const formatKnowledgeModelOptionLabel = (uniqueModelId: string) => {
  if (!isUniqueModelId(uniqueModelId)) {
    return uniqueModelId
  }

  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  return `${modelId} · ${providerId}`
}

const CreateKnowledgeBaseDialogHeader = ({ title }: { title: string }) => {
  return (
    <DialogHeader className="gap-0.5 border-border/40 border-b px-4 py-3 text-left">
      <DialogTitle className="leading-4">{title}</DialogTitle>
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
  emojis: readonly KnowledgeBaseEmoji[]
  value: KnowledgeBaseEmoji
  onChange: (value: KnowledgeBaseEmoji) => void
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
      <Button type="button" variant="outline" className="h-8 rounded-lg px-3" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button type="submit" loading={isCreating} className="h-8 rounded-lg px-3">
        {submitLabel}
      </Button>
    </DialogFooter>
  )
}

const CreateKnowledgeBaseDialogRoot = ({
  open,
  groups,
  initialGroupId,
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
  const groupIds = useMemo(() => new Set(groups.map((group) => group.id)), [groups])
  const normalizedInitialGroupId = initialGroupId && groupIds.has(initialGroupId) ? initialGroupId : undefined
  const [values, setValues] = useState<CreateKnowledgeBaseFormValues>(() =>
    createInitialInput(normalizedInitialGroupId)
  )
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setValues(createInitialInput(normalizedInitialGroupId))
      setHasAttemptedSubmit(false)
      setSubmitError(null)
    }
  }, [open, normalizedInitialGroupId])

  useEffect(() => {
    setValues((currentValues) => {
      if (!currentValues.groupId || groupIds.has(currentValues.groupId)) {
        return currentValues
      }

      return { ...currentValues, groupId: undefined }
    })
  }, [groupIds])

  const embeddingModelOptions: KnowledgeSelectOption[] = embeddingModels.map((model) => ({
    value: model.id,
    label: formatKnowledgeModelOptionLabel(model.id)
  }))

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    setSubmitError(null)

    if (!values.name.trim() || !values.embeddingModelId) {
      return
    }

    const createInput: CreateKnowledgeBaseInput = {
      name: values.name,
      emoji: values.emoji,
      embeddingModelId: values.embeddingModelId,
      dimensions: KNOWLEDGE_BASE_DEFAULT_DIMENSIONS
    }

    if (values.groupId && groupIds.has(values.groupId)) {
      createInput.groupId = values.groupId
    }

    let createdBase: KnowledgeBase

    try {
      createdBase = await createBase(createInput)
    } catch (error) {
      setSubmitError(formatErrorMessageWithPrefix(error, t('knowledge.error.failed_to_create')))
      return
    }

    onCreated(createdBase)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden rounded-2xl border-border/60 p-0">
        <CreateKnowledgeBaseDialog.Header title={t('knowledge.add.title')} />

        <CreateKnowledgeBaseDialog.Form onSubmit={handleSubmit}>
          <div className="space-y-3 px-4 py-3">
            <div className="space-y-1">
              <Label htmlFor="knowledge-create-name" className="text-muted-foreground leading-4">
                {t('common.name')}
              </Label>
              <Input
                id="knowledge-create-name"
                value={values.name}
                aria-invalid={hasAttemptedSubmit && !values.name.trim()}
                placeholder={t('common.name')}
                className="h-8 rounded-lg px-2.5 leading-4 placeholder:text-muted-foreground/70"
                onChange={(event) => setValues((currentValues) => ({ ...currentValues, name: event.target.value }))}
              />
              {hasAttemptedSubmit && !values.name.trim() ? (
                <FieldError className="leading-4">{t('knowledge.name_required')}</FieldError>
              ) : null}
            </div>

            <div className="space-y-1">
              <Label className="text-muted-foreground leading-4">{t('knowledge.add.icon')}</Label>
              <CreateKnowledgeBaseDialog.EmojiPicker
                emojis={KNOWLEDGE_BASE_EMOJIS}
                value={values.emoji}
                onChange={(emoji) => setValues((currentValues) => ({ ...currentValues, emoji }))}
              />
            </div>

            {groups.length > 0 ? (
              <div className="space-y-1">
                <Label className="text-muted-foreground leading-4">{t('knowledge.add.group')}</Label>
                <Select
                  value={values.groupId}
                  onValueChange={(groupId) =>
                    setValues((currentValues) => ({
                      ...currentValues,
                      groupId
                    }))
                  }>
                  <SelectTrigger
                    size="sm"
                    className="h-8 w-full rounded-lg px-2.5 leading-4 data-placeholder:text-muted-foreground/70">
                    <SelectValue placeholder={t('knowledge.groups.ungrouped')} />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-1">
              <Label className="text-muted-foreground leading-4">{t('knowledge.embedding_model')}</Label>
              <Select
                value={values.embeddingModelId ?? undefined}
                onValueChange={(embeddingModelId) =>
                  setValues((currentValues) => ({ ...currentValues, embeddingModelId }))
                }>
                <SelectTrigger
                  size="sm"
                  className="h-8 w-full rounded-lg px-2.5 leading-4 data-placeholder:text-muted-foreground/70"
                  aria-invalid={hasAttemptedSubmit && !values.embeddingModelId}>
                  <SelectValue placeholder={t('knowledge.not_set')} />
                </SelectTrigger>
                <SelectContent>
                  {embeddingModelOptions.length > 0 ? (
                    embeddingModelOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))
                  ) : (
                    <div className="px-2.5 py-2 text-muted-foreground text-sm">{t('knowledge.not_set')}</div>
                  )}
                </SelectContent>
              </Select>
              {hasAttemptedSubmit && !values.embeddingModelId ? (
                <FieldError className="leading-4">{t('knowledge.embedding_model_required')}</FieldError>
              ) : null}
            </div>

            {submitError ? <FieldError className="leading-4">{submitError}</FieldError> : null}
          </div>

          <CreateKnowledgeBaseDialog.Actions
            isCreating={isCreating}
            onCancel={() => onOpenChange(false)}
            cancelLabel={t('common.cancel')}
            submitLabel={t('knowledge.add.submit')}
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
