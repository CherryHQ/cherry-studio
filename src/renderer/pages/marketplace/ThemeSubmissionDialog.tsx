import { Check, Upload } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  SegmentedControl,
  Dialog,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Textarea
} from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { THEME_IMAGE_BYTE_LIMIT, THEME_IMAGE_TYPES } from '@shared/types/marketplaceTheme'

import { MarketplaceDetailBody, MarketplaceDetailContent, MarketplaceDetailFooter } from './MarketplaceComponents'

type Mode = 'light' | 'dark'
const exampleImage = 'https://assets.cherryai.com.cn/public/legacy/a4391dd7-473a-4cad-b6f5-6a429e3bbf0f'
const versionPattern = String.raw`\d+(\.\d+)*`
const tagPattern = String.raw`[a-zA-Z0-9\u4e00-\u9fa5,，\s]*`

async function readPreview(file: File | null) {
  if (!file) return null
  const type = THEME_IMAGE_TYPES.find((type) => type === file.type)
  if (!type || !file.size || file.size >= THEME_IMAGE_BYTE_LIMIT) throw new Error('Invalid theme preview')
  return { name: file.name, type, bytes: new Uint8Array(await file.arrayBuffer()) }
}

export function ThemeSubmissionDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<Mode>('light')
  const [pictures, setPictures] = useState<Record<Mode, File | null>>({ light: null, dark: null })
  const [previewUrl, setPreviewUrl] = useState('')
  const [exampleOpen, setExampleOpen] = useState(false)
  const file = pictures[mode]
  const modeLabel = t('settings.theme.' + mode)
  useEffect(() => {
    const url = open && file ? URL.createObjectURL(file) : ''
    setPreviewUrl(url)
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [open, file])
  const key = useRef<string | null>(null)
  const sending = useRef(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sending.current) return
    const fields = new FormData(event.currentTarget)
    const text = (name: string) => String(fields.get(name) ?? '')
    sending.current = true
    setPending(true)
    setError('')
    try {
      key.current ??= crypto.randomUUID()
      const [light_pic, dark_pic] = await Promise.all([readPreview(pictures.light), readPreview(pictures.dark)])
      await ipcApi.request('theme.marketplace.submit', {
        key: key.current,
        name: text('name').trim(),
        author: text('author').trim(),
        version: text('version'),
        code: text('code'),
        cdn_link: text('cdn_link').trim(),
        title: [
          ...new Set(
            text('tags')
              .split(/[,，\s]+/)
              .filter(Boolean)
          )
        ],
        light_pic,
        dark_pic
      })
      setOpen(false)
      toast.success(t('marketplace.theme.submitted'))
    } catch {
      setError(t('marketplace.theme.submit_failed'))
    } finally {
      sending.current = false
      setPending(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (sending.current) return
        if (next) {
          setError('')
          setMode('light')
          setPictures({ light: null, dark: null })
          setExampleOpen(false)
          key.current = null
        }
        setOpen(next)
      }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Upload />
          {t('marketplace.theme.submit')}
        </Button>
      </DialogTrigger>
      <MarketplaceDetailContent className="sm:max-w-2xl" showCloseButton={!pending}>
        <div className="space-y-1 border-b border-border-subtle px-5 py-4 pe-12">
          <DialogTitle>{t('marketplace.theme.submit')}</DialogTitle>
          <DialogDescription>{t('marketplace.theme.review_hint')}</DialogDescription>
        </div>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onInvalid={(event) => {
            const field = event.target
            if (
              (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) &&
              field.title &&
              !field.validity.customError
            )
              field.setCustomValidity(field.title)
          }}
          onInput={(event) => {
            const field = event.target
            if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.setCustomValidity('')
          }}
          onSubmit={submit}
          onChange={() => {
            key.current = null
            setError('')
          }}>
          <MarketplaceDetailBody>
            <fieldset disabled={pending} className="grid min-w-0 gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Label className="grid gap-2">
                  {t('common.name')} *
                  <Input
                    name="name"
                    placeholder={t('marketplace.theme.name_hint')}
                    title={t('marketplace.theme.name_hint')}
                    required
                    pattern=".*\S.*"
                  />
                </Label>
                <Label className="grid gap-2">
                  {t('marketplace.author')} *
                  <Input
                    name="author"
                    placeholder={t('marketplace.theme.author_hint')}
                    title={t('marketplace.theme.author_hint')}
                    required
                    pattern=".*\S.*"
                  />
                </Label>
                <Label className="grid gap-2">
                  {t('marketplace.version')} *
                  <Input
                    name="version"
                    required
                    defaultValue="1.0"
                    pattern={versionPattern}
                    placeholder="1.0"
                    title={t('marketplace.theme.version_hint')}
                  />
                  <span className="text-xs font-normal text-muted-foreground">
                    {t('marketplace.theme.version_hint')}
                  </span>
                </Label>
                <Label className="grid gap-2">
                  {t('library.config.basic.tags')}
                  <Input
                    name="tags"
                    pattern={tagPattern}
                    placeholder={t('marketplace.theme.tags_input')}
                    title={t('marketplace.theme.tags_hint')}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                      event.preventDefault()
                      const input = event.currentTarget
                      if (input.reportValidity() && input.value && !/[,，\s]$/.test(input.value)) input.value += ', '
                    }}
                  />
                  <span className="text-xs font-normal text-muted-foreground">{t('marketplace.theme.tags_hint')}</span>
                </Label>
              </div>
              <Label className="grid gap-2">
                CSS *
                <Textarea.Input
                  name="code"
                  placeholder={t('marketplace.theme.code_hint')}
                  title={t('marketplace.theme.css_required')}
                  required
                  spellCheck={false}
                  className="min-h-28 font-mono"
                  onBlur={(e) =>
                    e.currentTarget.setCustomValidity(
                      e.currentTarget.value.trim() ? '' : t('marketplace.theme.css_required')
                    )
                  }
                />
              </Label>
              <Label className="grid gap-2">
                {t('marketplace.theme.link_label')}
                <Input
                  name="cdn_link"
                  type="url"
                  pattern="https?://.+"
                  placeholder={t('marketplace.theme.link_hint')}
                />
              </Label>
              <fieldset className="space-y-3 rounded-lg border border-border-subtle p-3">
                <legend className="px-1 text-sm font-medium">{t('common.preview')}</legend>
                <SegmentedControl<Mode>
                  size="sm"
                  aria-label={t('common.preview')}
                  value={mode}
                  options={(['light', 'dark'] as const).map((value) => ({
                    value,
                    label: (
                      <>
                        {t('settings.theme.' + value)}
                        {pictures[value] && <Check className="size-3.5" aria-label={pictures[value].name} />}
                      </>
                    )
                  }))}
                  onValueChange={(next) => {
                    setMode(next)
                    setError('')
                  }}
                />
                {previewUrl && file && (
                  <div className="space-y-1">
                    <img
                      className="max-h-52 w-full rounded-md bg-background-subtle object-contain"
                      src={previewUrl}
                      alt={t('marketplace.theme.preview_label', { mode: modeLabel })}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">{file.name}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setPictures((current) => ({ ...current, [mode]: null }))
                          key.current = null
                          setError('')
                        }}>
                        {t('common.delete')}
                      </Button>
                    </div>
                  </div>
                )}
                <Label className="grid gap-2">
                  <span className="sr-only">{t('marketplace.theme.preview_label', { mode: modeLabel })}</span>
                  <span className="relative flex items-center justify-center gap-2 rounded-lg border border-dashed border-input bg-background-subtle p-3 text-sm font-normal hover:bg-accent focus-within:border-primary">
                    <Upload aria-hidden className="size-4" />
                    {t('marketplace.theme.upload_hint')}
                    <Input
                      key={mode}
                      className="absolute inset-0 size-full cursor-pointer opacity-0"
                      type="file"
                      name={mode + '_pic'}
                      accept={THEME_IMAGE_TYPES.join(',')}
                      required={!pictures.light && !pictures.dark}
                      title={t('marketplace.theme.image_required', { mode: modeLabel })}
                      onChange={(event) => {
                        const input = event.currentTarget
                        const next = input.files?.[0]
                        if (!next) return
                        if (
                          !next.size ||
                          next.size >= THEME_IMAGE_BYTE_LIMIT ||
                          !THEME_IMAGE_TYPES.some((type) => type === next.type)
                        ) {
                          input.value = ''
                          input.setCustomValidity(t('marketplace.theme.image_hint'))
                          input.reportValidity()
                          return
                        }
                        input.setCustomValidity('')
                        setPictures((current) => ({ ...current, [mode]: next }))
                        input.value = ''
                      }}
                    />
                  </span>
                </Label>
                <p className="text-xs text-muted-foreground">{t('marketplace.theme.image_hint')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('marketplace.theme.background_hint')}{' '}
                  <button
                    type="button"
                    className="text-link underline"
                    aria-expanded={exampleOpen}
                    onClick={() => setExampleOpen(!exampleOpen)}>
                    {t('marketplace.theme.view_example')}
                  </button>
                </p>
                {exampleOpen && (
                  <img
                    src={exampleImage}
                    alt={t('marketplace.theme.view_example')}
                    className="max-h-52 w-full rounded-md object-contain"
                  />
                )}
              </fieldset>
            </fieldset>
            {error && (
              <p role="alert" className="text-sm text-error">
                {error}
              </p>
            )}
          </MarketplaceDetailBody>
          <MarketplaceDetailFooter>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" type="submit" loading={pending} disabled={pending}>
              {pending ? t('marketplace.theme.submitting') : t('agent.askUserQuestion.submit')}
            </Button>
          </MarketplaceDetailFooter>
        </form>
      </MarketplaceDetailContent>
    </Dialog>
  )
}
