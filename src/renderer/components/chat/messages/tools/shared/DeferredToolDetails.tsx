import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { useToolResult } from '@renderer/hooks/useToolResult'
import { ipcApi } from '@renderer/ipc'
import type { DeferredToolResultRef } from '@shared/ai/transport'

import { useOptionalMessageListActions } from '../../MessageListProvider'

export function DeferredToolDetails({ resultRef }: { resultRef: DeferredToolResultRef }) {
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  const [cursors, setCursors] = useState([0])
  const firstRange = useToolResult(resultRef, { purpose: 'text-range', cursor: 0 })
  const cursor = cursors.at(-1) ?? 0
  const range = useToolResult(cursor === 0 ? undefined : resultRef, { purpose: 'text-range', cursor })
  const { state, isLoading } = cursor === 0 ? firstRange : range

  useEffect(() => {
    setCursors([0])
  }, [firstRange.generation])

  const copy = async () => {
    try {
      const result = await ipcApi.request('ai.tool.get_result', { ...resultRef, purpose: 'full' })
      if (result.status !== 'ready' || result.purpose !== 'full') throw new Error(result.status)
      const text = typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2)
      await actions?.copyText?.(text, { successMessage: t('message.copied') })
    } catch {
      actions?.notifyError?.(t('message.copy.failed'))
    }
  }

  return (
    <div className="space-y-2">
      {isLoading || state.status === 'pending' ? (
        <span role="status">{t('common.loading')}</span>
      ) : state.status === 'ready' && state.purpose === 'text-range' ? (
        <pre className="m-0 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{state.text}</pre>
      ) : (
        <span role="status">{t('message.tools.noData')}</span>
      )}
      <div className="flex items-center gap-2">
        {actions?.copyText && (
          <Button size="sm" variant="ghost" onClick={() => void copy()}>
            {t('common.copy')}
          </Button>
        )}
        {cursors.length > 1 && (
          <Button size="sm" variant="ghost" onClick={() => setCursors((current) => current.slice(0, -1))}>
            {t('common.previous')}
          </Button>
        )}
        {state.status === 'ready' && state.purpose === 'text-range' && state.nextCursor !== undefined && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const nextCursor = state.nextCursor
              if (nextCursor !== undefined) setCursors((current) => [...current, nextCursor])
            }}>
            {t('common.next')}
          </Button>
        )}
      </div>
    </div>
  )
}
