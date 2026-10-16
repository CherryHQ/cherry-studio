import { useTranslation } from 'react-i18next'

import { Button, CircularProgress, Spinner } from '@cherrystudio/ui'
import { useChatLayoutMode } from '@renderer/components/chat/layout/ChatLayoutModeContext'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { formatFileSize } from '@renderer/utils/file'
import type { ClaudeCodeBinaryStatus } from '@shared/ai/claudeCodeBinary'

const errorKeys = {
  network: 'agent.runtime_download.errors.network',
  integrity: 'agent.runtime_download.errors.integrity',
  storage: 'agent.runtime_download.errors.storage',
  unsupported: 'agent.runtime_download.errors.unsupported',
  installation: 'agent.runtime_download.errors.installation'
} as const

export function ClaudeCodeDownloadStatus({
  status,
  onRetry
}: {
  status?: ClaudeCodeBinaryStatus
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const runtime = t('library.config.agent.field.runtime.option.claude_code')
  const { railGutterPx } = useChatLayoutMode()
  const [narrowMode] = usePreference('chat.narrow_mode')
  const percent = status?.totalBytes
    ? Math.min(100, Math.floor((status.receivedBytes / status.totalBytes) * 100))
    : undefined
  const phase = status?.phase ?? 'missing'
  return (
    <NarrowLayout
      narrowMode={narrowMode}
      withSidePadding
      style={{ paddingLeft: 24 + railGutterPx, paddingRight: 24 + railGutterPx }}>
      <div
        className="pointer-events-auto mb-2 flex items-center gap-3 rounded-lg bg-muted px-3 py-2 text-sm"
        role="status"
        aria-live="polite">
        {phase !== 'error' &&
          (phase === 'downloading' && percent !== undefined ? (
            <div
              role="progressbar"
              aria-label={t('agent.runtime_download.downloading')}
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}>
              <CircularProgress value={percent} size={24} strokeWidth={2} />
            </div>
          ) : (
            <Spinner text={null} />
          ))}
        <div className="min-w-0 flex-1">
          <div>{t('agent.runtime_download.title', { runtime })}</div>
          <div className="text-muted-foreground">
            {phase === 'error'
              ? t(errorKeys[status?.error ?? 'installation'], { runtime })
              : phase === 'installing'
                ? t('agent.runtime_download.installing')
                : phase === 'downloading'
                  ? t('agent.runtime_download.downloading')
                  : t('agent.runtime_download.preparing')}
            {phase === 'downloading' && (
              <span>
                {' '}
                {percent !== undefined ? `${percent}% · ` : ''}
                {formatFileSize(status?.receivedBytes ?? 0)}
              </span>
            )}
          </div>
        </div>
        {phase === 'error' && status?.error !== 'unsupported' && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        )}
      </div>
    </NarrowLayout>
  )
}
