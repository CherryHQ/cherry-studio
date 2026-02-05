import { DividerWithText } from '@cherrystudio/ui'
import type { FC, PropsWithChildren } from 'react'
import React from 'react'

interface SidebarSectionContextValue {
  title: string
}

const SidebarSectionContext = React.createContext<SidebarSectionContextValue | null>(null)

const useSidebarSectionContext = () => {
  const context = React.use(SidebarSectionContext)
  if (!context) {
    throw new Error('SidebarSection components must be used within SidebarSection.Root')
  }
  return context
}

interface SidebarSectionRootProps extends PropsWithChildren {
  title: string
}

const SidebarSectionRoot: FC<SidebarSectionRootProps> = ({ title, children }) => (
  <SidebarSectionContext value={{ title }}>
    <div className="flex flex-col gap-1">{children}</div>
  </SidebarSectionContext>
)

const SidebarSectionTitle: FC = () => {
  const { title } = useSidebarSectionContext()
  return <DividerWithText text={title} />
}

const SidebarSectionList: FC<PropsWithChildren> = ({ children }) => (
  <div className="flex flex-col gap-1">{children}</div>
)

const SidebarSection = {
  Root: SidebarSectionRoot,
  Title: SidebarSectionTitle,
  List: SidebarSectionList
}

export default SidebarSection
