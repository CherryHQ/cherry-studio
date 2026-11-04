import { Bug } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@cherrystudio/ui'
import { useMiniAppWebview } from '@renderer/hooks/useMiniAppRuntime'
import { useWebviewDebugging } from '@renderer/hooks/useWebviewDebugging'

export function MiniAppDebuggingIndicator({ appId }: { appId: string }) {
  const { t } = useTranslation()
  const resource = useMiniAppWebview(appId)
  const debugging = useWebviewDebugging(resource?.element ?? null)
  if (!debugging) return null
  return (
    <Badge variant="outline" role="status" className="shrink-0 gap-1 text-warning">
      <Bug size={12} aria-hidden="true" />
      {t('miniApp.debugging')}
    </Badge>
  )
}
