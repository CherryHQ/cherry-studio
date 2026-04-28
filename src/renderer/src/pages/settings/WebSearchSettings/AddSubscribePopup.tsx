import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Flex,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input
} from '@cherrystudio/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { TopView } from '@renderer/components/TopView'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

interface ShowParams {
  title: string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ title, resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()

  const schema = z.object({
    url: z
      .string()
      .min(1, t('settings.tool.websearch.url_required'))
      .refine(
        (value) => {
          try {
            new URL(value.trim())
            return true
          } catch {
            return false
          }
        },
        { message: t('settings.tool.websearch.url_invalid') }
      ),
    name: z.string().optional()
  })

  type FieldType = z.infer<typeof schema>

  const form = useForm<FieldType>({
    resolver: zodResolver(schema),
    defaultValues: { url: '', name: '' }
  })

  const onClose = () => {
    resolve({})
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setOpen(false)
      onClose()
    }
  }

  const onSubmit = (values: FieldType) => {
    const url = values.url.trim()
    const name = values.name?.trim() || url
    resolve({ url, name })
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[480px]"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('settings.tool.websearch.subscribe_url')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://git.io/ublacklist"
                      spellCheck={false}
                      maxLength={500}
                      {...field}
                      onChange={(e) => {
                        field.onChange(e)
                        try {
                          const url = new URL(e.target.value)
                          form.setValue('name', url.hostname)
                        } catch {
                          // ignore invalid URL
                        }
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('settings.tool.websearch.subscribe_name.label')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('settings.tool.websearch.subscribe_name.placeholder')}
                      spellCheck={false}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Flex className="mt-2 justify-end">
              <Button type="submit">{t('settings.tool.websearch.subscribe_add')}</Button>
            </Flex>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export default class AddSubscribePopup {
  static topviewId = 0
  static hide() {
    TopView.hide('AddSubscribePopup')
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        'AddSubscribePopup'
      )
    })
  }
}
