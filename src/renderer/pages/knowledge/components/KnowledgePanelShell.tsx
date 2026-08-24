import { type ReactNode } from 'react'

interface KnowledgePanelShellProps {
  children: ReactNode
  header?: ReactNode
  headerClassName?: string
  className?: string
}

const KnowledgePanelShell = ({ children, header, headerClassName, className }: KnowledgePanelShellProps) => {
  return (
    <section className={`flex h-full min-h-0 flex-1 flex-col ${className ?? ''}`}>
      {header ? <div className={headerClassName ?? 'shrink-0 px-3 pt-3 pb-2'}>{header}</div> : null}
      {children}
    </section>
  )
}

export default KnowledgePanelShell
