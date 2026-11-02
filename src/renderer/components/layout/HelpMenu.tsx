import {
  BookOpen,
  ChevronRight,
  CircleQuestionMark,
  FileArchive,
  MessageSquareText,
  Sparkles,
  Stethoscope
} from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import AppLogo from '@renderer/assets/images/logo.png'
import { DoctorPopup } from '@renderer/components/doctor'
import { useAccountSubmenu } from '@renderer/hooks/useAccountSubmenu'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { useOpenReleaseNotes } from '@renderer/hooks/useOpenReleaseNotes'

const logger = loggerService.withContext('HelpMenu')

export function HelpMenu({
  onFeedbackClick,
  onRequestClose
}: {
  onFeedbackClick: () => void
  onRequestClose?: () => void
}) {
  const { t, i18n } = useTranslation()
  const { openSmartMiniApp } = useMiniAppPopup()
  const openReleaseNotes = useOpenReleaseNotes()
  const {
    open: menuOpen,
    onOpenChange: setMenuOpen,
    initialFocusRef: firstActionRef,
    triggerProps,
    contentProps
  } = useAccountSubmenu()
  const pendingActionRef = useRef<(() => void | Promise<void>) | null>(null)

  const runAfterClose = (action: () => void | Promise<void>) => {
    pendingActionRef.current = action
    setMenuOpen(false)
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

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      aria-label={t('help.title')}
      size="sm"
      {...triggerProps}
      className="h-8 min-h-8 w-full justify-start gap-2 rounded-md bg-transparent px-2 py-0 text-[13px] text-foreground leading-5">
      <CircleQuestionMark className="!text-muted-foreground size-4" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-left">{t('help.title')}</span>
      <ChevronRight className="!text-muted-foreground size-4" aria-hidden />
    </Button>
  )

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align="end"
          side="right"
          sideOffset={8}
          className="w-52 rounded-md p-1.5"
          {...contentProps}
          onCloseAutoFocus={(event) => {
            contentProps.onCloseAutoFocus(event)
            const action = pendingActionRef.current
            if (!action) return
            pendingActionRef.current = null
            event.preventDefault()
            void Promise.resolve()
              .then(() => {
                onRequestClose?.()
                return action()
              })
              .catch((error) => logger.error('Failed to run help menu action', error as Error))
          }}>
          <MenuList className="gap-0.5">
            <MenuItem
              size="sm"
              className="h-8 gap-2 rounded-md border-0 bg-transparent px-2 py-0 text-[13px] leading-5 [&_svg]:text-muted-foreground"
              ref={firstActionRef}
              icon={<Sparkles size={16} />}
              label={t('help.whats_new')}
              onClick={() => runAfterClose(openReleaseNotes)}
            />
            <MenuItem
              size="sm"
              className="h-8 gap-2 rounded-md border-0 bg-transparent px-2 py-0 text-[13px] leading-5 [&_svg]:text-muted-foreground"
              icon={<BookOpen size={16} />}
              label={t('help.guide')}
              onClick={() => runAfterClose(openDocs)}
            />
            <MenuItem
              size="sm"
              className="h-8 gap-2 rounded-md border-0 bg-transparent px-2 py-0 text-[13px] leading-5 [&_svg]:text-muted-foreground"
              icon={<FileArchive size={16} />}
              label={t('settings.about.feedback.diagnostics.title')}
              onClick={() =>
                runAfterClose(async () => {
                  await DoctorPopup.show({ initialPanel: 'report' })
                })
              }
            />
            <MenuItem
              size="sm"
              className="h-8 gap-2 rounded-md border-0 bg-transparent px-2 py-0 text-[13px] leading-5 [&_svg]:text-muted-foreground"
              icon={<MessageSquareText size={16} />}
              label={t('help.feedback')}
              onClick={() => runAfterClose(onFeedbackClick)}
            />
            <MenuItem
              size="sm"
              className="h-8 gap-2 rounded-md border-0 bg-transparent px-2 py-0 text-[13px] leading-5 [&_svg]:text-muted-foreground"
              icon={<Stethoscope size={16} />}
              label={t('settings.doctor.entry.title')}
              onClick={() =>
                runAfterClose(async () => {
                  await DoctorPopup.show({ initialPanel: 'checks' })
                })
              }
            />
          </MenuList>
        </PopoverContent>
      </Popover>
    </>
  )
}
