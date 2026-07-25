import { useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { useTranslation } from 'react-i18next'

/**
 * Surface a background topic / agent-session auto-naming failure as a toast.
 *
 * The naming summarization runs in a main-process background job with no origin window;
 * on failure it emits `ai.topic_naming_failed` to the main window only
 * (`broadcastToType(WindowType.Main)`). Main-only IPC->toast subscriber, twin of
 * `useAppUpdateHandler` — mounted once from `MainWindowRuntime`.
 */
export function useTopicNamingErrorNotification(): void {
  const { t } = useTranslation()

  useIpcOn('ai.topic_naming_failed', ({ message }) => {
    toast.error({ title: t('chat.topics.auto_rename_failed'), description: message })
  })
}
