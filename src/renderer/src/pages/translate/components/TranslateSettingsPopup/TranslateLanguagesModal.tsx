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
import { useTranslateLanguages } from '@renderer/hooks/translate'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { parsePersistedLangCode, PersistedLangCodeSchema } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

type Props = {
  isOpen: boolean
  editingLanguage?: TranslateLanguage
  onCancel: () => void
}

const logger = loggerService.withContext('TranslateLanguagesModal')
const DEFAULT_EMOJI = '🏳️'

const TranslateLanguagesModal = ({ isOpen, editingLanguage: editingCustomLanguage, onCancel }: Props) => {
  const { t } = useTranslation()
  const {
    languages,
    add: addLanguage,
    update: updateLanguage
  } = useTranslateLanguages({
    add: { showErrorToast: false },
    update: { showErrorToast: false }
  })

  const langCodeList = useMemo(() => languages?.map((item) => item.langCode) ?? [], [languages])

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
          .refine((value) => PersistedLangCodeSchema.safeParse(value.toLowerCase()).success, {
            message: t('settings.translate.custom.error.langCode.invalid')
          })
          .refine(
            (value) => {
              const normalized = value.toLowerCase()
              const clashes = langCodeList.some((code) => code === normalized)
              logger.silly('validate langCode', { value, normalized, langCodeList, editingCustomLanguage })
              if (editingCustomLanguage) {
                return !clashes || normalized === editingCustomLanguage.langCode
              }
              return !clashes
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
      try {
        if (editingCustomLanguage) {
          await updateLanguage(editingCustomLanguage.langCode, { value, emoji })
        } else {
          await addLanguage({ value, emoji, langCode: parsePersistedLangCode(langCode.toLowerCase()) })
        }
        onCancel() // Only close the modal on success — failures keep the form state so the user can retry.
      } catch (e) {
        logger.error('Failed to submit translate language form', e as Error)
        window.toast.error(formatErrorMessageWithPrefix(e, t('translate.settings.error.save')))
      }
    },
    [addLanguage, updateLanguage, editingCustomLanguage, onCancel, t]
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
                    <Input
                      disabled={editingCustomLanguage !== undefined}
                      placeholder={t('settings.translate.custom.langCode.placeholder')}
                      {...field}
                    />
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

export default TranslateLanguagesModal
