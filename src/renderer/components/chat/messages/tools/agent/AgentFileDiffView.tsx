import type { ReactNode } from 'react'
import { lazy, Suspense } from 'react'

const AgentFileDiffRenderer = lazy(() => import('./AgentFileDiffRenderer'))

export interface AgentFileDiffHunk {
  oldString?: string
  newString?: string
}

export function AgentFileDiffView({
  children,
  filePath,
  hunks
}: {
  children?: ReactNode
  filePath?: string
  hunks: AgentFileDiffHunk[]
}) {
  return (
    <div className="relative">
      <Suspense fallback={null}>
        <AgentFileDiffRenderer filePath={filePath} hunks={hunks} />
      </Suspense>
      {children}
    </div>
  )
}
