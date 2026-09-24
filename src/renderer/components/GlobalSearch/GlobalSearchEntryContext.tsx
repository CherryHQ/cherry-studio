import { memo } from 'react'

import { useGlobalSearchSessionContext, useGlobalSearchTopicContext } from '@renderer/hooks/useGlobalSearchEntryContext'

function EntryContext({ name, workspaceName, path }: { name?: string; workspaceName?: string; path?: string }) {
  const label = [name, workspaceName].filter(Boolean).join(' | ')
  if (!label) return null

  return (
    <span
      className="ml-2 max-w-[40%] shrink-0 truncate text-muted-foreground text-xs leading-4"
      title={path ? [name, path].filter(Boolean).join(' | ') : label}>
      {label}
    </span>
  )
}

export const GlobalSearchTopicContext = memo(function GlobalSearchTopicContext({ topicId }: { topicId: string }) {
  const context = useGlobalSearchTopicContext(topicId)
  return <EntryContext {...context} />
})

export const GlobalSearchSessionContext = memo(function GlobalSearchSessionContext({
  sessionId
}: {
  sessionId: string
}) {
  const context = useGlobalSearchSessionContext(sessionId)
  return <EntryContext {...context} />
})
