import { Button, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import type { SidebarVisibleLayout } from '@renderer/components/Sidebar'
import { useOpenReleaseNotes } from '@renderer/hooks/useOpenReleaseNotes'
import { ipcApi } from '@renderer/ipc'
import { BookOpen, CircleQuestionMark, Github, MessageSquareText, Sparkles } from 'lucide-react'
import { lazy, Suspense, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const FeedbackDialog = lazy(() => import('../feedback/FeedbackDialog'))

const GITHUB_REPOSITORY_URL = 'https://github.com/CherryHQ/cherry-studio'

export function HelpMenu({ layout }: { layout: SidebarVisibleLayout }) {
  const { t, i18n } = useTranslation()
  const openReleaseNotes = useOpenReleaseNotes()
  const [menuOpen, setMenuOpen] = useState(false)
  const [feedbackDialogMounted, setFeedbackDialogMounted] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const firstActionRef = useRef<HTMLButtonElement>(null)

  const runAfterClose = (action: () => void | Promise<void>) => {
    setMenuOpen(false)
    window.setTimeout(() => void action(), 0)
  }

  const openDocs = () => {
    const language = i18n.resolvedLanguage ?? i18n.language
    const url =
      language === 'zh-CN' || language === 'zh-TW'
        ? 'https://docs.cherry-ai.com/'
        : 'https://docs.cherry-ai.com/docs/en-us'
    return ipcApi.request('system.shell.open_website', url)
  }

  const openFeedback = () => {
    setFeedbackDialogMounted(true)
    setFeedbackOpen(true)
  }

  const trigger =
    layout === 'icon' ? (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t('help.title')}
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground dark:text-muted-foreground">
        <CircleQuestionMark size={18} strokeWidth={1.6} />
      </Button>
    ) : (
      <Button
        type="button"
        variant="ghost"
        aria-label={t('help.title')}
        className="flex w-full items-center justify-start gap-2.5 rounded-lg px-2.5 py-1.75 text-[13px] text-foreground transition-colors hover:bg-accent/60">
        <CircleQuestionMark size={16} strokeWidth={1.6} />
        <span>{t('help.title')}</span>
      </Button>
    )

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip
          content={t('help.title')}
          placement="right"
          delay={800}
          fullWidthTrigger={layout !== 'icon'}
          isDisabled={layout !== 'icon'}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        </Tooltip>
        <PopoverContent
          align="end"
          side="right"
          sideOffset={8}
          className="w-52 rounded-xl p-1.5"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            firstActionRef.current?.focus()
          }}>
          <MenuList>
            <MenuItem
              size="sm"
              className="h-8"
              ref={firstActionRef}
              icon={<Sparkles size={16} />}
              label={t('help.whats_new')}
              onClick={() => runAfterClose(openReleaseNotes)}
            />
            <MenuItem
              size="sm"
              className="h-8"
              icon={<BookOpen size={16} />}
              label={t('help.guide')}
              onClick={() => runAfterClose(openDocs)}
            />
            <MenuItem
              size="sm"
              className="h-8"
              icon={<MessageSquareText size={16} />}
              label={t('help.feedback')}
              onClick={() => runAfterClose(openFeedback)}
            />
            <MenuItem
              size="sm"
              className="h-8"
              icon={<Github size={16} />}
              label={t('help.star')}
              onClick={() => runAfterClose(() => ipcApi.request('system.shell.open_website', GITHUB_REPOSITORY_URL))}
            />
          </MenuList>
        </PopoverContent>
      </Popover>

      {feedbackDialogMounted ? (
        <Suspense fallback={null}>
          <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
        </Suspense>
      ) : null}
    </>
  )
}
