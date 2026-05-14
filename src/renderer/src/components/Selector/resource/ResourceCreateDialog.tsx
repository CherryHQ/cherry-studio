import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmojiAvatar,
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import EmojiPicker from '@renderer/components/EmojiPicker'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { ChevronsUpDown } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ModelSelector } from '../model'

export type ResourceCreateDialogKind = 'assistant' | 'agent'

export type ResourceCreateDialogValues = {
  avatar: string
  name: string
  modelId: UniqueModelId
  description: string
}

type ResourceCreateDialogProps = {
  kind: ResourceCreateDialogKind
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: ResourceCreateDialogValues) => Promise<void> | void
  modelFilter?: (model: Model) => boolean
  isSubmitting?: boolean
}

function getDefaults(kind: ResourceCreateDialogKind) {
  return kind === 'assistant' ? { avatar: '💬' } : { avatar: '🤖' }
}

export function ResourceCreateDialog({
  kind,
  open,
  onOpenChange,
  onSubmit,
  modelFilter,
  isSubmitting = false
}: ResourceCreateDialogProps) {
  const { t } = useTranslation()
  const nameId = useId()
  const modelId = useId()
  const descriptionId = useId()
  const defaults = getDefaults(kind)
  const [avatar, setAvatar] = useState(defaults.avatar)
  const [name, setName] = useState('')
  const [selectedModel, setSelectedModel] = useState<Model | undefined>(undefined)
  const [description, setDescription] = useState('')
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return

    setAvatar(defaults.avatar)
    setName('')
    setSelectedModel(undefined)
    setDescription('')
    setEmojiPickerOpen(false)
    setSubmitted(false)
    setSubmitError(null)
  }, [defaults.avatar, open])

  const trimmedName = name.trim()
  const nameError = submitted && trimmedName.length === 0 ? t('selector.create_dialog.name_required') : undefined
  const modelError = submitted && !selectedModel ? t('selector.create_dialog.model_required') : undefined
  const title = t(
    kind === 'assistant' ? 'selector.create_dialog.assistant_title' : 'selector.create_dialog.agent_title'
  )

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      setSubmitted(true)
      setSubmitError(null)

      if (!trimmedName || !selectedModel?.id) {
        return
      }

      try {
        await onSubmit({
          avatar,
          name: trimmedName,
          modelId: selectedModel.id,
          description: description.trim()
        })
      } catch (error) {
        setSubmitError(
          error instanceof Error && error.message ? error.message : t('selector.create_dialog.submit_failed')
        )
      }
    },
    [avatar, description, onSubmit, selectedModel?.id, t, trimmedName]
  )

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}>
      <DialogContent
        className="sm:max-w-[460px]"
        onPointerDownOutside={(event) => isSubmitting && event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{t('selector.create_dialog.dialog_description')}</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-[auto_1fr] items-start gap-3">
            <Field className="gap-1.5">
              <FieldLabel>{t('common.avatar')}</FieldLabel>
              <FieldContent>
                <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={t('selector.create_dialog.avatar_aria')}
                      disabled={isSubmitting}
                      className="size-9 min-h-0 rounded-[20%] p-0 text-foreground shadow-none transition-opacity hover:bg-transparent hover:text-foreground hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50">
                      <EmojiAvatar size={36} fontSize={18}>
                        {avatar}
                      </EmojiAvatar>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <EmojiPicker
                      onEmojiClick={(emoji) => {
                        setAvatar(emoji)
                        setEmojiPickerOpen(false)
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </FieldContent>
            </Field>

            <Field data-invalid={Boolean(nameError) || undefined} className="min-w-0 gap-1.5">
              <FieldLabel htmlFor={nameId}>{t('common.name')}</FieldLabel>
              <FieldContent>
                <Input
                  id={nameId}
                  value={name}
                  disabled={isSubmitting}
                  placeholder={t('selector.create_dialog.name_placeholder')}
                  aria-invalid={Boolean(nameError) || undefined}
                  onChange={(event) => setName(event.target.value)}
                />
                <FieldError className="text-xs" errors={nameError ? [{ message: nameError }] : undefined} />
              </FieldContent>
            </Field>
          </div>

          <Field data-invalid={Boolean(modelError) || undefined} className="gap-1.5">
            <FieldLabel id={modelId}>{t('common.model')}</FieldLabel>
            <FieldContent>
              <div
                className={cn(
                  'rounded-md border bg-accent/15 transition-colors',
                  modelError ? 'border-destructive/50' : 'border-border/20'
                )}>
                <ModelSelector
                  multiple={false}
                  selectionType="model"
                  value={selectedModel}
                  filter={modelFilter}
                  listVisibleCount={8}
                  onSelect={setSelectedModel}
                  trigger={
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={isSubmitting}
                      aria-labelledby={modelId}
                      className="flex h-auto min-h-0 w-full items-center justify-between gap-1.5 rounded-sm px-3 py-2 font-normal text-foreground text-xs shadow-none hover:bg-accent/50 focus-visible:ring-0">
                      <span className="min-w-0 truncate text-left">
                        {selectedModel?.name ?? t('selector.create_dialog.model_placeholder')}
                      </span>
                      <ChevronsUpDown size={12} className="shrink-0 text-muted-foreground/80" />
                    </Button>
                  }
                />
              </div>
              <FieldError className="text-xs" errors={modelError ? [{ message: modelError }] : undefined} />
            </FieldContent>
          </Field>

          <Field className="gap-1.5">
            <FieldLabel htmlFor={descriptionId}>{t('common.description')}</FieldLabel>
            <FieldContent>
              <Textarea.Input
                id={descriptionId}
                value={description}
                disabled={isSubmitting}
                rows={3}
                placeholder={t('selector.create_dialog.description_placeholder')}
                onValueChange={setDescription}
              />
            </FieldContent>
          </Field>

          {submitError ? <p className="text-destructive text-xs">{submitError}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {t('selector.create_dialog.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
