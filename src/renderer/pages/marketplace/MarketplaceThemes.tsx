import { Clock3, Copy, ImageIcon, Link2, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRInfinite from 'swr/infinite'

import { Badge, Button, Dialog, DialogDescription, DialogTitle } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { previewCustomCss } from '@renderer/hooks/useCustomCss'
import { ipcApi } from '@renderer/ipc'
import { cn } from '@renderer/utils/style'
import type { MarketplaceTheme } from '@shared/ipc/schemas/theme'

import {
  MarketplaceDetailBody,
  MarketplaceDetailContent,
  MarketplaceDetailFooter,
  MarketplaceLoadState
} from './MarketplaceComponents'
import { ThemeSubmissionDialog } from './ThemeSubmissionDialog'

const PAGE_SIZE = 6

export function useMarketplaceThemes(query: string, enabled: boolean) {
  const words = query.trim().split(/\s+/)
  const author = words.find((word) => word.startsWith('@'))?.slice(1) ?? ''
  const tag = words.find((word) => word.startsWith('#'))?.slice(1) ?? ''
  const search = words.filter((word) => !word.startsWith('@') && !word.startsWith('#')).join(' ')
  return useSWRInfinite(
    (page, previous) =>
      enabled && !(previous && page * PAGE_SIZE >= previous.total)
        ? (['theme.marketplace.list', search, author, tag, page * PAGE_SIZE] as const)
        : null,
    ([, search, author, tag, offset]) =>
      ipcApi.request('theme.marketplace.list', { offset, limit: PAGE_SIZE, search, author, tag }),
    { shouldRetryOnError: false, revalidateFirstPage: false, revalidateOnFocus: false }
  )
}

export function MarketplaceThemes({
  catalog,
  preview
}: {
  catalog: Pick<
    ReturnType<typeof useMarketplaceThemes>,
    'data' | 'isLoading' | 'isValidating' | 'error' | 'size' | 'setSize' | 'mutate'
  >
  preview: boolean
}) {
  const { t } = useTranslation()
  const [, save] = usePreference('ui.custom_css')
  const [selected, select] = useState<MarketplaceTheme | null>(null)
  const [dark, setDark] = useState(false)
  const [trial, setTrial] = useState<{ theme: MarketplaceTheme; until: number } | null>(null)
  const [remaining, setRemaining] = useState(10)
  const [status, setStatus] = useState('')
  useEffect(() => {
    if (!trial) return
    previewCustomCss(trial.theme.code)
    const tick = () => {
      const seconds = Math.ceil((trial.until - Date.now()) / 1000)
      if (seconds <= 0) setTrial(null)
      else setRemaining(seconds)
    }
    tick()
    const timer = window.setInterval(tick, 200)
    return () => {
      window.clearInterval(timer)
      previewCustomCss(null)
    }
  }, [trial])
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setStatus(t('common.copied'))
    } catch {
      setStatus(t('common.copy_failed'))
    }
  }
  const keep = async () => {
    if (!trial || Date.now() >= trial.until) return
    setTrial(null)
    try {
      await save(trial.theme.code)
    } catch {
      setStatus(t('common.save_failed'))
    }
  }
  const pages = catalog.data ?? []
  const items = preview ? (pages[0]?.items.slice(0, 3) ?? []) : pages.flatMap((page) => page.items)
  const picture = selected && (dark ? selected.dark_pic : selected.light_pic)
  return (
    <div className="space-y-4">
      {!preview && (
        <div className="flex justify-end">
          <ThemeSubmissionDialog />
        </div>
      )}
      {trial && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-border-subtle bg-popover p-3 text-popover-foreground">
          <Clock3 aria-hidden className="size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              {trial.theme.name} <span className="ms-1 tabular-nums">{remaining}s</span>
            </div>
            <p className="text-xs text-muted-foreground">{t('marketplace.theme.preview_timeout')}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setTrial(null)}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={keep}>
            {t('common.save')}
          </Button>
        </div>
      )}
      {status && !selected && (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      )}
      <div
        className={cn(
          'grid grid-cols-1 gap-4 @[520px]:grid-cols-2 @[920px]:grid-cols-3',
          preview && '@max-[520px]:[&>:nth-child(n+2)]:hidden @max-[920px]:[&>:nth-child(3)]:hidden'
        )}>
        {items.map((theme) => (
          <Button
            key={theme.id}
            variant="ghost"
            data-ui="marketplace.theme-card"
            className="group h-auto min-w-0 flex-col items-stretch justify-start gap-0 overflow-hidden whitespace-normal rounded-xl border border-border-subtle bg-card p-0 text-start text-card-foreground hover:border-border-strong focus-visible:border-border-strong motion-reduce:transition-none"
            onClick={() => {
              select(theme)
              setDark(!theme.light_pic)
              setStatus('')
            }}>
            <span className="flex aspect-video items-center justify-center overflow-hidden bg-background-subtle">
              {theme.light_pic || theme.dark_pic ? (
                <img
                  alt=""
                  loading="lazy"
                  src={theme.light_pic || theme.dark_pic}
                  className="size-full object-contain motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out motion-safe:group-hover:scale-[1.03] motion-safe:group-focus-visible:scale-[1.03]"
                />
              ) : (
                <ImageIcon aria-hidden className="size-6 text-foreground-tertiary" />
              )}
            </span>
            <span className="space-y-1 border-t border-border-subtle p-3">
              <span className="block truncate text-sm font-medium" title={theme.name}>
                {theme.name}
              </span>
              <span className="flex items-center justify-between gap-2 text-xs font-normal text-muted-foreground">
                <span className="truncate">{theme.author}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {theme.light_mode && (
                    <span title={t('settings.theme.light')}>
                      <Sun aria-label={t('settings.theme.light')} className="size-3.5" />
                    </span>
                  )}
                  {theme.dark_mode && (
                    <span title={t('settings.theme.dark')}>
                      <Moon aria-label={t('settings.theme.dark')} className="size-3.5" />
                    </span>
                  )}
                </span>
              </span>
            </span>
          </Button>
        ))}
      </div>
      <MarketplaceLoadState
        loading={catalog.isLoading}
        error={catalog.error}
        empty={!items.length}
        retry={() => catalog.mutate()}
      />
      {!preview && !catalog.error && items.length < (pages[0]?.total ?? 0) && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={catalog.isValidating}
            onClick={() => void catalog.setSize(catalog.size + 1)}>
            {t('notification.center.load_more')}
          </Button>
        </div>
      )}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) select(null)
        }}>
        {selected && (
          <MarketplaceDetailContent className="sm:max-w-3xl">
            <div className="space-y-1 border-b border-border-subtle px-5 py-4 pe-12">
              <DialogTitle>{selected.name}</DialogTitle>
              <DialogDescription>
                {selected.author} · v{selected.version}
              </DialogDescription>
            </div>
            <MarketplaceDetailBody>
              {selected.light_pic && selected.dark_pic && (
                <div className="flex justify-end gap-1">
                  {[false, true].map((mode) => (
                    <Button
                      key={String(mode)}
                      size="sm"
                      variant={mode === dark ? 'secondary' : 'ghost'}
                      aria-pressed={mode === dark}
                      onClick={() => setDark(mode)}>
                      {mode ? <Moon /> : <Sun />}
                      {t(mode ? 'settings.theme.dark' : 'settings.theme.light')}
                    </Button>
                  ))}
                </div>
              )}
              {picture && (
                <img
                  src={picture}
                  alt={selected.name}
                  className="max-h-[52vh] w-full rounded-lg bg-background-subtle object-contain"
                />
              )}
              {selected.description && <p className="text-sm">{selected.description}</p>}
              {selected.title.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selected.title.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
              {status && (
                <p role="status" className="text-sm text-muted-foreground">
                  {status}
                </p>
              )}
            </MarketplaceDetailBody>
            <MarketplaceDetailFooter>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => void copy(selected.code)}>
                  <Copy />
                  {t('common.copy')} CSS
                </Button>
                {selected.cdn_link && (
                  <Button size="sm" variant="ghost" onClick={() => void copy(selected.cdn_link)}>
                    <Link2 />
                    {t('common.link.copy')}
                  </Button>
                )}
              </div>
              <Button
                disabled={!selected.code}
                onClick={() => {
                  setStatus('')
                  setTrial({ theme: selected, until: Date.now() + 10000 })
                  setRemaining(10)
                  select(null)
                }}>
                {t('common.preview')}
              </Button>
            </MarketplaceDetailFooter>
          </MarketplaceDetailContent>
        )}
      </Dialog>
    </div>
  )
}
