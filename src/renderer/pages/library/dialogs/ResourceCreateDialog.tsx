import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea
} from '@cherrystudio/ui'
import { ModelSelector } from '@renderer/components/Selector/model'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
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

type ResourceCreateFormValues = {
  avatar: string
  name: string
  selectedModel?: Model
  description: string
}

function getDefaultAvatar(kind: ResourceCreateDialogKind) {
  return kind === 'assistant' ? '💬' : '🤖'
}

function getDefaultValues(kind: ResourceCreateDialogKind): ResourceCreateFormValues {
  return {
    avatar: getDefaultAvatar(kind),
    name: '',
    selectedModel: undefined,
    description: ''
  }
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
  const form = useForm<ResourceCreateFormValues>({ defaultValues: getDefaultValues(kind) })
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [dialogContentElement, setDialogContentElement] = useState<HTMLDivElement | null>(null)
  const submitting = isSubmitting || form.formState.isSubmitting
  const rootError = form.formState.errors.root?.message
  const defaultAvatar = getDefaultAvatar(kind)

  useEffect(() => {
    if (!open) return

    form.reset(getDefaultValues(kind))
    form.clearErrors()
    setEmojiPickerOpen(false)
  }, [form, kind, open])

  const title = t(
    kind === 'assistant' ? 'library.config.dialogs.create.assistant_title' : 'library.config.dialogs.create.agent_title'
  )

  const handleSubmit = form.handleSubmit(
    async (values) => {
      form.clearErrors('root')
      try {
        await onSubmit({
          avatar: values.avatar,
          name: values.name.trim(),
          modelId: values.selectedModel!.id,
          description: values.description.trim()
        })
      } catch {
        form.setError('root', { message: t('library.config.dialogs.create.submit_failed') })
      }
    },
    () => form.clearErrors('root')
  )

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !submitting && onOpenChange(nextOpen)}>
      <DialogContent
        ref={setDialogContentElement}
        closeOnOverlayClick={!submitting}
        className="sm:max-w-[460px]"
        onPointerDownOutside={(event) => submitting && event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('library.config.dialogs.create.dialog_description')}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="grid grid-cols-[auto_1fr] items-start gap-3">
              <FormField
                control={form.control}
                name="avatar"
                render={({ field }) => (
                  <FormItem className="gap-1.5">
                    <FormLabel>{t('common.avatar')}</FormLabel>
                    <EmojiAvatarPicker
                      value={field.value}
                      fallback={defaultAvatar}
                      open={emojiPickerOpen}
                      onOpenChange={setEmojiPickerOpen}
                      onChange={field.onChange}
                      ariaLabel={t('library.config.dialogs.create.avatar_aria')}
                      disabled={submitting}
                      portalContainer={dialogContentElement}
                      size="sm"
                    />
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="name"
                rules={{
                  validate: (value) => value.trim().length > 0 || t('library.config.dialogs.create.name_required')
                }}
                render={({ field }) => (
                  <FormItem className="min-w-0 gap-1.5">
                    <FormLabel>{t('common.name')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        disabled={submitting}
                        placeholder={t('library.config.dialogs.create.name_placeholder')}
                      />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="selectedModel"
              rules={{
                validate: (value) => Boolean(value?.id) || t('library.config.dialogs.create.model_required')
              }}
              render={({ field, fieldState }) => (
                <FormItem className="gap-1.5">
                  <FormLabel>{t('common.model')}</FormLabel>
                  <FormControl>
                    <DialogModelFrame invalid={fieldState.invalid}>
                      <div className="w-full min-w-0">
                        <ModelSelector
                          multiple={false}
                          selectionType="model"
                          value={field.value}
                          filter={modelFilter}
                          portalContainer={dialogContentElement}
                          onSelect={field.onChange}
                          trigger={
                            <DialogModelTrigger
                              disabled={submitting}
                              ariaLabel={t('common.model')}
                              model={field.value}
                              displayLabel={field.value?.name ?? t('library.config.dialogs.create.model_placeholder')}
                              className={
                                field.value
                                  ? 'w-full hover:bg-background hover:text-foreground'
                                  : 'w-full hover:bg-background hover:text-muted-foreground'
                              }
                            />
                          }
                        />
                      </div>
                    </DialogModelFrame>
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem className="gap-1.5">
                  <FormLabel>{t('common.description')}</FormLabel>
                  <FormControl>
                    <Textarea.Input
                      value={field.value}
                      disabled={submitting}
                      rows={3}
                      placeholder={t('library.config.dialogs.create.description_placeholder')}
                      onValueChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />

            {rootError ? <p className="text-destructive text-xs">{rootError}</p> : null}

            <DialogFooter>
              <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={submitting}>
                {t('library.config.dialogs.create.submit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
