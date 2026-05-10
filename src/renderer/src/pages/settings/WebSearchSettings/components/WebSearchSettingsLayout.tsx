import Scrollbar from '@renderer/components/Scrollbar'
import type { FC, ReactNode } from 'react'

interface WebSearchSettingsLayoutProps {
  sidebar: ReactNode
  children: ReactNode
}

interface WebSearchContentHeaderProps {
  icon: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}

export const WebSearchSettingsLayout: FC<WebSearchSettingsLayoutProps> = ({ sidebar, children }) => (
  <div className="flex flex-1">
    <div className="m-2 ml-0 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02]">
      <div className="flex min-h-0 flex-1">
        {sidebar}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  </div>
)

export const WebSearchContentScroll: FC<{ children: ReactNode }> = ({ children }) => (
  <Scrollbar className="min-h-0 flex-1 [&::-webkit-scrollbar-thumb]:bg-border/20 [&::-webkit-scrollbar]:w-[3px]">
    <div className="flex min-h-full w-full flex-col gap-4 px-6 py-5">{children}</div>
  </Scrollbar>
)

export const WebSearchContentHeader: FC<WebSearchContentHeaderProps> = ({ icon, title, description, action }) => (
  <div className="mb-1 flex items-center justify-between gap-4">
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.04] text-foreground/35">
        {icon}
      </div>
      <div className="min-w-0">
        <h3 className="truncate font-semibold text-foreground/90 text-sm">{title}</h3>
        {description ? <p className="mt-0.5 text-foreground/35 text-xs leading-tight">{description}</p> : null}
      </div>
    </div>
    {action ? <div className="shrink-0">{action}</div> : null}
  </div>
)
