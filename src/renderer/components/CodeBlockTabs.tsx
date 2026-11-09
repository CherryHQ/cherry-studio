import { type ReactNode, useState } from 'react'

import { ScrollArea, Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'

import { CodeBlockTabContext } from './codeBlockTabContext'

interface CodeBlockTabsProps {
  label: string
  items: { id: string; label: string; icon?: ReactNode; content: ReactNode }[]
}

export function CodeBlockTabs({ label, items }: CodeBlockTabsProps) {
  const [toolbarContainer, setToolbarContainer] = useState<HTMLDivElement | null>(null)
  const [selected, setSelected] = useState(items[0]?.id)
  const [visited, setVisited] = useState<string[]>([])
  const active = items.some((item) => item.id === selected) ? selected : items[0]?.id
  if (selected !== active) setSelected(active)
  if (active && !visited.includes(active)) setVisited([...visited, active])

  return (
    <Tabs
      value={active}
      onValueChange={setSelected}
      className="group/code-tabs relative my-4 min-w-0 gap-0 overflow-clip rounded-xl border border-border-subtle bg-background-subtle">
      <div className="code-block-header flex min-w-0 items-center gap-2 border-b border-border-subtle p-1">
        <ScrollArea
          orientation="horizontal"
          type="hover"
          className="min-w-0 flex-1"
          viewportProps={{ className: 'overscroll-x-contain' }}>
          <TabsList aria-label={label} className="h-9 w-max justify-start gap-0.5 bg-transparent p-0">
            {items.map((item) => (
              <TabsTrigger
                key={item.id}
                value={item.id}
                className="h-8 flex-none rounded-lg px-3 font-normal text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=active]:text-foreground motion-reduce:transition-none"
                onFocus={(event) => event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })}>
                {item.icon}
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </ScrollArea>
        <div
          ref={setToolbarContainer}
          className="shrink-0 px-1.5 opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover/code-tabs:opacity-100 group-focus-within/code-tabs:opacity-100 [@media(hover:none)]:opacity-100"
        />
      </div>
      {items.map((item) => (
        <TabsContent
          key={item.id}
          value={item.id}
          forceMount
          hidden={item.id !== active}
          className="min-w-0 data-[state=inactive]:hidden [&>pre]:my-0!">
          <CodeBlockTabContext value={item.id === active ? toolbarContainer : null}>
            {visited.includes(item.id) || item.id === active ? item.content : null}
          </CodeBlockTabContext>
        </TabsContent>
      ))}
    </Tabs>
  )
}
