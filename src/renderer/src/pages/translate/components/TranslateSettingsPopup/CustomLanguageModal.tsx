import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  InfoTooltip,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@cherrystudio/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { loggerService } from '@logger'
import EmojiPicker from '@renderer/components/EmojiPicker'
import { useTranslate } from '@renderer/hooks/translate'
import { addCustomLanguage, updateCustomLanguage } from '@renderer/services/TranslateService'
import type { CustomTranslateLanguage } from '@renderer/types'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

type Props = {
  isOpen: boolean
  editingCustomLanguage?: CustomTranslateLanguage
  onAdd: (item: CustomTranslateLanguage) => void
  onEdit: (item: CustomTranslateLanguage) => void
  onCancel: () => void
}

const logger = loggerService.withContext('CustomLanguageModal')
const DEFAULT_EMOJI = '🏳️'

const CustomLanguageModal = ({ isOpen, editingCustomLanguage, onAdd, onEdit, onCancel }: Props) => {
  const { t } = useTranslation()
  const { translateLanguages } = useTranslate()

  const langCodeList = useMemo(() => translateLanguages.map((item) => item.langCode), [translateLanguages])

  const schema = useMemo(
    () =>
      z.object({
        emoji: z.string().min(1),
        value: z
          .string()
          .min(1, t('settings.translate.custom.error.value.empty'))
          .max(32, t('settings.translate.custom.error.value.too_long')),
        langCode: z
          .string()
          .min(1, t('settings.translate.custom.error.langCode.empty'))
          .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,3})?$/, t('settings.translate.custom.error.langCode.invalid'))
          .refine(
            (value) => {
              logger.silly('validate langCode', { value, langCodeList, editingCustomLanguage })
              const normalized = value.toLowerCase()
              if (editingCustomLanguage) {
                return !langCodeList.includes(value) || value === editingCustomLanguage.langCode
              }
              return !langCodeList.includes(normalized)
            },
            { message: t('settings.translate.custom.error.langCode.exists') }
          )
      }),
    [t, langCodeList, editingCustomLanguage]
  )

  type FieldType = z.infer<typeof schema>

  const form = useForm<FieldType>({
    resolver: zodResolver(schema) as any,
    defaultValues: { emoji: DEFAULT_EMOJI, value: '', langCode: '' }
  })

  useEffect(() => {
    if (!isOpen) return
    if (editingCustomLanguage) {
      form.reset({
        emoji: editingCustomLanguage.emoji,
        value: editingCustomLanguage.value,
        langCode: editingCustomLanguage.langCode
      })
    } else {
      form.reset({ emoji: DEFAULT_EMOJI, value: '', langCode: '' })
    }
  }, [editingCustomLanguage, isOpen, form])

  const title = useMemo(
    () => (editingCustomLanguage ? t('common.edit') : t('common.add')) + t('translate.custom.label'),
    [editingCustomLanguage, t]
  )

  const handleSubmit = useCallback(
    async (values: FieldType) => {
      const { emoji, value, langCode } = values

      if (editingCustomLanguage) {
        try {
          await updateCustomLanguage(editingCustomLanguage, value, emoji, langCode)
          onEdit({ ...editingCustomLanguage, emoji, value, langCode })
          window.toast.success(t('settings.translate.custom.success.update'))
        } catch (e) {
          window.toast.error(t('settings.translate.custom.error.update') + ': ' + (e as Error).message)
        }
      } else {
        try {
          const added = await addCustomLanguage(value, emoji, langCode)
          onAdd(added)
          window.toast.success(t('settings.translate.custom.success.add'))
        } catch (e) {
          window.toast.error(t('settings.translate.custom.error.add') + ': ' + (e as Error).message)
        }
      }
      onCancel()
    },
    [editingCustomLanguage, onCancel, t, onEdit, onAdd]
  )

  return (
    <Dialog open={isOpen} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-[480px]" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="emoji"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-3 [&>label]:w-20">
                  <FormLabel>Emoji</FormLabel>
                  <FormControl>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button type="button" size="icon" variant="outline" className="aspect-square">
                          <Emoji emoji={field.value} />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <EmojiPicker onEmojiClick={(emoji) => field.onChange(emoji)} />
                      </PopoverContent>
                    </Popover>
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="value"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    <span>{t('settings.translate.custom.value.label')}</span>
                    <InfoTooltip content={t('settings.translate.custom.value.help')} />
                  </FormLabel>
                  <FormControl>
                    <Input placeholder={t('settings.translate.custom.value.placeholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="langCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    <span>{t('settings.translate.custom.langCode.label')}</span>
                    <InfoTooltip content={t('settings.translate.custom.langCode.help')} />
                  </FormLabel>
                  <FormControl>
                    <Input placeholder={t('settings.translate.custom.langCode.placeholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onCancel}>
                {t('common.cancel')}
              </Button>
              <Button type="submit">{editingCustomLanguage ? t('common.save') : t('common.add')}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

const Emoji: FC<{ emoji: string; size?: number }> = ({ emoji, size = 18 }) => {
  return <div style={{ lineHeight: 0, fontSize: size }}>{emoji}</div>
}

export default CustomLanguageModal
