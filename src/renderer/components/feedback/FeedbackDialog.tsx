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
import { usePreference } from '@renderer/data/hooks/usePreference'
import { ipcApi } from '@renderer/ipc'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { CHERRY_SUPPORT_AGENT_ID } from '@shared/ai/builtinAgent'
import { Bot, ChevronRight, FileArchive, Github } from 'lucide-react'
import { lazy, type ReactNode, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

const DiagnosticUploadDialog = lazy(() => import('./DiagnosticUploadDialog'))

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
  const [diagnosticUploadOpen, setDiagnosticUploadOpen] = useState(false)
  const [hiddenBuiltinAgentIds, setHiddenBuiltinAgentIds] = usePreference('agent.session.hidden_builtin_ids')

  const selectOption = (action: () => void | Promise<void>) => {
    onOpenChange(false)
    window.setTimeout(() => {
      void Promise.resolve()
        .then(action)
        .catch((error) => logger.error('Failed to run deferred feedback action', error as Error))
    }, 0)
  }

  const openAgentFeedback = async () => {
    try {
      if (hiddenBuiltinAgentIds.includes(CHERRY_SUPPORT_AGENT_ID)) {
        await setHiddenBuiltinAgentIds(hiddenBuiltinAgentIds.filter((agentId) => agentId !== CHERRY_SUPPORT_AGENT_ID))
      }
      const { sessionId } = await ipcApi.request('ai.agent.support_session.create')
      openRoute(getFeedbackAgentRoute(sessionId))
    } catch (error) {
      logger.error('Failed to open Cherry Support feedback', error as Error)
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
    <>
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
              onSelect={() => selectOption(() => setDiagnosticUploadOpen(true))}
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

      {diagnosticUploadOpen ? (
        <Suspense fallback={null}>
          <DiagnosticUploadDialog open onOpenChange={setDiagnosticUploadOpen} />
        </Suspense>
      ) : null}
    </>
  )
}

export default FeedbackDialog
