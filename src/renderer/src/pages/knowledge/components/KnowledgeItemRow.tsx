import type { FC, ReactNode } from 'react'

interface KnowledgeItemRowProps {
  icon: ReactNode
  content: ReactNode
  metadata?: ReactNode
  actions: ReactNode
}

export const KnowledgeItemRow: FC<KnowledgeItemRowProps> = ({ icon, content, metadata, actions }) => {
  return (
    <div className="flex min-w-0 flex-row items-center justify-between border-border border-b px-2 py-1">
      <div className="flex min-w-0 flex-1 cursor-pointer flex-row items-center gap-2 overflow-hidden">
        {icon}
        {content}
        {metadata && (
          <>
            <div className="text-foreground-muted">|</div>
            <div className="truncate text-foreground-muted">{metadata}</div>
          </>
        )}
      </div>
      <div className="shrink-0">{actions}</div>
    </div>
  )
}
