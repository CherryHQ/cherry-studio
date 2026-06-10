import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
  Input,
  Textarea
} from '@cherrystudio/ui'
import { ModelSelector } from '@renderer/components/Selector/model'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { type FormEvent, useCallback, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DialogModelFrame, DialogModelTrigger, EmojiAvatarPicker } from './components/DialogFormFields'

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

type SubmitState = { kind: 'idle' } | { kind: 'submitted' } | { kind: 'error'; message: string }

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
  const [dialogContentElement, setDialogContentElement] = useState<HTMLDivElement | null>(null)
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: 'idle' })

  useEffect(() => {
    if (!open) return

    setAvatar(defaults.avatar)
    setName('')
    setSelectedModel(undefined)
    setDescription('')
    setEmojiPickerOpen(false)
    setSubmitState({ kind: 'idle' })
  }, [defaults.avatar, open])

  const trimmedName = name.trim()
  const submitted = submitState.kind !== 'idle'
  const submitError = submitState.kind === 'error' ? submitState.message : undefined
  const nameError = submitted && trimmedName.length === 0 ? t('library.config.dialogs.create.name_required') : undefined
  const modelError = submitted && !selectedModel ? t('library.config.dialogs.create.model_required') : undefined
  const title = t(
    kind === 'assistant' ? 'library.config.dialogs.create.assistant_title' : 'library.config.dialogs.create.agent_title'
  )

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      setSubmitState({ kind: 'submitted' })

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
      } catch {
        setSubmitState({ kind: 'error', message: t('library.config.dialogs.create.submit_failed') })
      }
    },
    [avatar, description, onSubmit, selectedModel?.id, t, trimmedName]
  )

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}>
      <DialogContent
        ref={setDialogContentElement}
        className="sm:max-w-[460px]"
        onPointerDownOutside={(event) => isSubmitting && event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('library.config.dialogs.create.dialog_description')}
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-[auto_1fr] items-start gap-3">
            <Field className="gap-1.5">
              <FieldLabel>{t('common.avatar')}</FieldLabel>
              <FieldContent>
                <EmojiAvatarPicker
                  value={avatar}
                  fallback={defaults.avatar}
                  open={emojiPickerOpen}
                  onOpenChange={setEmojiPickerOpen}
                  onChange={setAvatar}
                  ariaLabel={t('library.config.dialogs.create.avatar_aria')}
                  disabled={isSubmitting}
                  portalContainer={dialogContentElement}
                  size="sm"
                />
              </FieldContent>
            </Field>

            <Field data-invalid={Boolean(nameError) || undefined} className="min-w-0 gap-1.5">
              <FieldLabel htmlFor={nameId}>{t('common.name')}</FieldLabel>
              <FieldContent>
                <Input
                  id={nameId}
                  value={name}
                  disabled={isSubmitting}
                  placeholder={t('library.config.dialogs.create.name_placeholder')}
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
              <DialogModelFrame invalid={Boolean(modelError)}>
                <ModelSelector
                  multiple={false}
                  selectionType="model"
                  value={selectedModel}
                  filter={modelFilter}
                  portalContainer={dialogContentElement}
                  onSelect={setSelectedModel}
                  trigger={
                    <DialogModelTrigger
                      disabled={isSubmitting}
                      ariaLabelledBy={modelId}
                      model={selectedModel}
                      displayLabel={selectedModel?.name ?? t('library.config.dialogs.create.model_placeholder')}
                    />
                  }
                />
              </DialogModelFrame>
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
                placeholder={t('library.config.dialogs.create.description_placeholder')}
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
              {t('library.config.dialogs.create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
