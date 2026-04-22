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
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { isUniqueModelId, MODEL_CAPABILITY, parseUniqueModelId } from '@shared/data/types/model'
import type { FormEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface CreateKnowledgeBaseDialogProps {
  open: boolean
  isCreating: boolean
  createBase: (input: CreateKnowledgeBaseInput) => Promise<KnowledgeBase>
  onOpenChange: (open: boolean) => void
  onCreated: (base: KnowledgeBase) => void
}

const DEFAULT_EMOJI = '📁'
const DEFAULT_DIMENSIONS = '1536'
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
    <DialogHeader className="gap-1 border-border/40 border-b px-5 py-4 text-left">
      <DialogTitle className="font-semibold text-base">{title}</DialogTitle>
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
    <div className="grid grid-cols-5 gap-2">
      {emojis.map((emoji) => {
        const selected = emoji === value

        return (
          <button
            key={emoji}
            type="button"
            aria-label={emoji}
            aria-pressed={selected}
            className={cn(
              'flex h-10 w-full items-center justify-center rounded-xl border border-border/50 bg-muted/20 text-lg transition-colors',
              selected ? 'border-foreground/60 bg-accent text-foreground' : 'hover:bg-accent/60'
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
    <DialogFooter className="border-border/40 border-t px-5 py-4 sm:justify-end">
      <Button type="button" variant="outline" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button type="submit" loading={isCreating}>
        {submitLabel}
      </Button>
    </DialogFooter>
  )
}

const CreateKnowledgeBaseDialogRoot = ({
  open,
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

    let createdBase: KnowledgeBase

    try {
      // TODO: Resolve dimensions from the selected embedding model before creating the knowledge base.
      const dimensions = DEFAULT_DIMENSIONS
      createdBase = await createBase({ ...values, dimensions })
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
          <div className="space-y-4 px-5 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="knowledge-v2-create-name">{t('common.name')}</Label>
              <Input
                id="knowledge-v2-create-name"
                value={values.name}
                aria-invalid={hasAttemptedSubmit && !values.name.trim()}
                placeholder={t('common.name')}
                onChange={(event) => setValues((currentValues) => ({ ...currentValues, name: event.target.value }))}
              />
              {hasAttemptedSubmit && !values.name.trim() ? (
                <FieldError>{t('knowledge_v2.name_required')}</FieldError>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label>{t('knowledge_v2.add.icon')}</Label>
              <CreateKnowledgeBaseDialog.EmojiPicker
                emojis={KNOWLEDGE_BASE_EMOJIS}
                value={values.emoji}
                onChange={(emoji) => setValues((currentValues) => ({ ...currentValues, emoji }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t('knowledge_v2.embedding_model')}</Label>
              <Select
                value={values.embeddingModelId ?? undefined}
                onValueChange={(embeddingModelId) =>
                  setValues((currentValues) => ({ ...currentValues, embeddingModelId }))
                }>
                <SelectTrigger aria-invalid={hasAttemptedSubmit && !values.embeddingModelId}>
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
                    <div className="px-2 py-1.5 text-muted-foreground text-sm">{t('knowledge_v2.not_set')}</div>
                  )}
                </SelectContent>
              </Select>
              {hasAttemptedSubmit && !values.embeddingModelId ? (
                <FieldError>{t('knowledge_v2.embedding_model_required')}</FieldError>
              ) : null}
            </div>

            {submitError ? <FieldError>{submitError}</FieldError> : null}
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
