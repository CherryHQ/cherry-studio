import * as ContextMenu from '@radix-ui/react-context-menu'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { Columns2, Rows2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { useSplitView } from '../../hooks/useSplitView'

interface TabContextMenuProps {
  tab: Tab
  children: ReactNode
}

export const TabContextMenu = ({ tab, children }: TabContextMenuProps) => {
  const { splitPane, unsplit, isSplit } = useSplitView(tab.id)

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="fade-in-0 zoom-in-95 z-50 min-w-[160px] animate-in rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <ContextMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent focus:bg-accent"
            onSelect={() => splitPane('horizontal')}>
            <Columns2 className="size-4" />
            Split Right
          </ContextMenu.Item>
          <ContextMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent focus:bg-accent"
            onSelect={() => splitPane('vertical')}>
            <Rows2 className="size-4" />
            Split Down
          </ContextMenu.Item>
          {isSplit && (
            <>
              <ContextMenu.Separator className="my-1 h-px bg-border" />
              <ContextMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent focus:bg-accent"
                onSelect={unsplit}>
                Unsplit
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
