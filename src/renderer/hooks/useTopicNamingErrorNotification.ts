import { useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { useTranslation } from 'react-i18next'

/**
 * Surface a background topic / agent-session auto-naming failure as a toast.
 *
 * The naming summarization runs in a main-process background job; on failure it
 * broadcasts `ai.topic_naming_failed`. Intentionally main-only (twin of
 * `useStorageMonitorNotification`): the event is a broadcast, so listening in the
 * shared `useWindowRuntime` — which both main and subWindow mount — would double-toast
 * when both windows are open. Mount once, in `MainWindowRuntime`.
 */
export function useTopicNamingErrorNotification(): void {
  const { t } = useTranslation()

  useIpcOn('ai.topic_naming_failed', ({ message }) => {
    toast.error({ title: t('chat.topics.auto_rename_failed'), description: message })
  })
}
