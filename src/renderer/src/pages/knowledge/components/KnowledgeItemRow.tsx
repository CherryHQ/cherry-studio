import type { FC, ReactNode } from 'react'

interface KnowledgeItemRowProps {
  icon: ReactNode
  content: ReactNode
  metadata?: ReactNode
  actions: ReactNode
}

export const KnowledgeItemRow: FC<KnowledgeItemRowProps> = ({ icon, content, metadata, actions }) => {
  return (
    <div className="flex flex-row items-center justify-between border-border border-b px-2 py-1">
      <div className="flex cursor-pointer flex-row items-center gap-2">
        {icon}
        {content}
        {metadata && (
          <>
            <div className="text-foreground-muted">|</div>
            <div className="text-foreground-muted">{metadata}</div>
          </>
        )}
      </div>
      {actions}
    </div>
  )
}
