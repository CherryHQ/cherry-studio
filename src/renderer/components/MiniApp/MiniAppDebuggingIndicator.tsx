import { Bug } from 'lucide-react'
import { useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@cherrystudio/ui'
import { useWebviewDebugging } from '@renderer/hooks/useWebviewDebugging'
import { getWebviewElement, onWebviewElementChange } from '@renderer/services/MiniAppWebviewService'

export function MiniAppDebuggingIndicator({ appId }: { appId: string }) {
  const { t } = useTranslation()
  const webview = useSyncExternalStore(
    useCallback((notify) => onWebviewElementChange(appId, notify), [appId]),
    useCallback(() => getWebviewElement(appId), [appId]),
    () => null
  )
  const debugging = useWebviewDebugging(webview)
  if (!debugging) return null
  return (
    <Badge variant="outline" role="status" className="shrink-0 gap-1 text-warning">
      <Bug size={12} aria-hidden="true" />
      {t('miniApp.debugging')}
    </Badge>
  )
}
