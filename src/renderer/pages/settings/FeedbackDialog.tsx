import {
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle
} from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { Bot, ChevronRight, ClipboardList, Github } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export const FEEDBACK_SURVEY_URL = 'https://mcnnox2fhjfq.feishu.cn/share/base/form/shrcnsjfFkx4gy6wx9LQ70tMaKe'
export const FEEDBACK_GITHUB_URL = 'https://github.com/CherryHQ/cherry-studio/issues/new/choose'
export const FEEDBACK_AGENT_ROUTE = '/app/agents?intent=feedback'

export function isChineseFeedbackLanguage(language: string | undefined): boolean {
  return language === 'zh-CN' || language === 'zh-TW'
}

interface FeedbackDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface FeedbackOptionProps {
  description: string
  icon: ReactNode
  recommended?: boolean
  title: string
  onSelect: () => void | Promise<void>
}

function FeedbackOption({ description, icon, recommended = false, title, onSelect }: FeedbackOptionProps) {
  const { t } = useTranslation()

  return (
    <Item asChild size="sm" variant="outline" className="w-full cursor-pointer rounded-xl hover:bg-accent/50">
      <button type="button" onClick={() => void onSelect()}>
        <ItemMedia
          variant="icon"
          className="border-primary/20 bg-primary/10 text-primary [&_.lucide:not(.lucide-custom)]:text-current!">
          {icon}
        </ItemMedia>
        <ItemContent className="min-w-0 text-left">
          <ItemTitle>
            {title}
            {recommended && (
              <Badge className="border-primary/20 bg-primary/10 text-primary">
                {t('settings.about.feedback.recommended')}
              </Badge>
            )}
          </ItemTitle>
          <ItemDescription className="line-clamp-none">{description}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <ChevronRight className="size-4 text-muted-foreground" />
        </ItemActions>
      </button>
    </Item>
  )
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const showSurvey = isChineseFeedbackLanguage(language)

  const selectOption = (action: () => void | Promise<void>) => {
    onOpenChange(false)
    void action()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('settings.about.feedback.dialog.title')}</DialogTitle>
          <DialogDescription>{t('settings.about.feedback.dialog.description')}</DialogDescription>
        </DialogHeader>

        <ItemGroup className="gap-3 px-2">
          <FeedbackOption
            icon={<Bot className="size-5" />}
            title={t('settings.about.feedback.agent.title')}
            description={t('settings.about.feedback.agent.description')}
            recommended
            onSelect={() => selectOption(() => openRoute(FEEDBACK_AGENT_ROUTE))}
          />
          <FeedbackOption
            icon={<Github className="size-5" />}
            title={t('settings.about.feedback.github.title')}
            description={t('settings.about.feedback.github.description')}
            onSelect={() => selectOption(() => ipcApi.request('system.shell.open_website', FEEDBACK_GITHUB_URL))}
          />
          {showSurvey && (
            <FeedbackOption
              icon={<ClipboardList className="size-5" />}
              title={t('settings.about.feedback.survey.title')}
              description={t('settings.about.feedback.survey.description')}
              onSelect={() => selectOption(() => ipcApi.request('system.shell.open_website', FEEDBACK_SURVEY_URL))}
            />
          )}
        </ItemGroup>
      </DialogContent>
    </Dialog>
  )
}
