import { Button, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import AppLogo from '@renderer/assets/images/logo.png'
import type { SidebarVisibleLayout } from '@renderer/components/Sidebar'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { useOpenReleaseNotes } from '@renderer/hooks/useOpenReleaseNotes'
import { ipcApi } from '@renderer/ipc'
import { BookOpen, CircleQuestionMark, Github, MessageSquareText, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const GITHUB_REPOSITORY_URL = 'https://github.com/CherryHQ/cherry-studio'
const logger = loggerService.withContext('HelpMenu')

export function HelpMenu({
  layout,
  onFeedbackClick,
  onOverlayOpenChange
}: {
  layout: SidebarVisibleLayout
  onFeedbackClick: () => void
  onOverlayOpenChange?: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const { openSmartMiniApp } = useMiniAppPopup()
  const openReleaseNotes = useOpenReleaseNotes()
  const [menuOpen, setMenuOpen] = useState(false)
  const firstActionRef = useRef<HTMLButtonElement>(null)
  const menuOpenRef = useRef(false)
  const onOverlayOpenChangeRef = useRef(onOverlayOpenChange)
  const pendingActionRef = useRef<(() => void | Promise<void>) | null>(null)

  useEffect(() => {
    onOverlayOpenChangeRef.current = onOverlayOpenChange
  }, [onOverlayOpenChange])

  useEffect(
    () => () => {
      if (menuOpenRef.current) {
        onOverlayOpenChangeRef.current?.(false)
      }
    },
    []
  )

  const handleMenuOpenChange = (open: boolean) => {
    menuOpenRef.current = open
    setMenuOpen(open)
    onOverlayOpenChange?.(open)
  }

  const runAfterClose = (action: () => void | Promise<void>) => {
    pendingActionRef.current = action
    handleMenuOpenChange(false)
  }

  const openDocs = () => {
    const language = i18n.resolvedLanguage ?? i18n.language
    const url =
      language === 'zh-CN' || language === 'zh-TW'
        ? 'https://docs.cherryai.com.cn/'
        : 'https://docs.cherryai.com.cn/docs/en-us'
    openSmartMiniApp({
      appId: 'cherrystudio-guide',
      name: t('help.guide'),
      url,
      logo: AppLogo
    })
  }

  const openGitHubRepository = () => {
    return ipcApi.request('system.shell.open_website', GITHUB_REPOSITORY_URL)
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
        className="flex w-full min-w-0 items-center justify-start gap-2.5 overflow-hidden rounded-lg px-2.5 py-1.75 text-[13px] text-foreground transition-colors hover:bg-accent/60">
        <CircleQuestionMark size={16} strokeWidth={1.6} />
        <span className="min-w-0 truncate">{t('help.title')}</span>
      </Button>
    )

  return (
    <>
      <Popover open={menuOpen} onOpenChange={handleMenuOpenChange}>
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
          onCloseAutoFocus={(event) => {
            const action = pendingActionRef.current
            if (!action) return
            pendingActionRef.current = null
            event.preventDefault()
            void Promise.resolve()
              .then(action)
              .catch((error) => logger.error('Failed to run help menu action', error as Error))
          }}
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
              onClick={() => runAfterClose(onFeedbackClick)}
            />
            <MenuItem
              size="sm"
              className="h-8"
              icon={<Github size={16} />}
              label={t('help.star')}
              onClick={() => runAfterClose(openGitHubRepository)}
            />
          </MenuList>
        </PopoverContent>
      </Popover>
    </>
  )
}
