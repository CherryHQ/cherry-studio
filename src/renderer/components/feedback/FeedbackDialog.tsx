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
import { loggerService } from '@logger'
import DoctorPopup from '@renderer/components/doctor/DoctorPopup'
import { ipcApi } from '@renderer/ipc'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { POPUP_EXIT_MS } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { Bot, ChevronRight, FileArchive, Github } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export const FEEDBACK_GITHUB_URL = 'https://github.com/CherryHQ/cherry-studio/issues/new/choose'

const logger = loggerService.withContext('FeedbackDialog')

export function getFeedbackAgentRoute(sessionId: string): string {
  return `/app/agents?intent=feedback&sessionId=${encodeURIComponent(sessionId)}`
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
            {recommended ? (
              <Badge className="border-primary/20 bg-primary/10 text-primary">
                {t('settings.about.feedback.recommended')}
              </Badge>
            ) : null}
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
  const { t } = useTranslation()

  const selectOption = (action: () => void | Promise<void>, delay = 0) => {
    onOpenChange(false)
    window.setTimeout(() => {
      void Promise.resolve()
        .then(action)
        .catch((error) => logger.error('Failed to run deferred feedback action', error as Error))
    }, delay)
  }

  const openAgentFeedback = async () => {
    try {
      const { sessionId } = await ipcApi.request('ai.agent.support_session.create')
      openRoute(getFeedbackAgentRoute(sessionId))
    } catch (error) {
      logger.error('Failed to create Cherry Support feedback session', error as Error)
      toast.error(t('settings.about.feedback.agent_error'))
    }
  }

  const openGitHubIssue = async () => {
    try {
      await ipcApi.request('system.shell.open_website', FEEDBACK_GITHUB_URL)
    } catch (error) {
      logger.error('Failed to open GitHub issue chooser', error as Error)
      toast.error(t('settings.about.feedback.github.error'))
    }
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
            icon={<FileArchive className="size-5" />}
            title={t('settings.about.feedback.diagnostics.title')}
            description={t('settings.about.feedback.diagnostics.description')}
            recommended
            onSelect={() => selectOption(() => void DoctorPopup.show({ initialPanel: 'report' }), POPUP_EXIT_MS)}
          />
          <FeedbackOption
            icon={<Bot className="size-5" />}
            title={t('settings.about.feedback.agent.title')}
            description={t('settings.about.feedback.agent.description')}
            onSelect={() => selectOption(openAgentFeedback)}
          />
          <FeedbackOption
            icon={<Github className="size-5" />}
            title={t('settings.about.feedback.github.title')}
            description={t('settings.about.feedback.github.description')}
            onSelect={() => selectOption(openGitHubIssue)}
          />
        </ItemGroup>
      </DialogContent>
    </Dialog>
  )
}

export default FeedbackDialog
