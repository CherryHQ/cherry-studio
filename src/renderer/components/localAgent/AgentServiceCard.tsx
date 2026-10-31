import type { ReactNode } from 'react'

export function AgentServiceCard({
  icon,
  title,
  version,
  versionAction,
  controls,
  actions,
  trailing,
  children
}: {
  icon: ReactNode
  title: ReactNode
  version?: string
  versionAction?: ReactNode
  controls: ReactNode
  actions: ReactNode
  trailing?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border-subtle bg-card">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center">{icon}</div>
          <div className="flex min-h-11 min-w-0 flex-col justify-center gap-1">
            <h1 className="truncate text-[15px] leading-tight font-semibold">{title}</h1>
            {(version || versionAction) && (
              <div className="flex h-5 min-w-0 items-center gap-1.5">
                {version && (
                  <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                    {version.startsWith('v') ? version : `v${version}`}
                  </p>
                )}
                <div className="flex size-5 shrink-0 items-center justify-center">{versionAction}</div>
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">{controls}</div>
        <div className="flex flex-wrap items-center gap-2 empty:hidden">{actions}</div>
        {trailing && <div className="ml-auto flex shrink-0 items-center gap-1.5">{trailing}</div>}
      </header>
      <div className="space-y-2.5 border-t border-border-subtle bg-muted/20 px-5 py-3">{children}</div>
    </section>
  )
}
