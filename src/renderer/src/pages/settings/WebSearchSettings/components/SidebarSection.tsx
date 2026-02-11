import { DividerWithText } from '@cherrystudio/ui'
import type { FC, ReactNode } from 'react'

interface SidebarSectionTitleProps {
  text: string
}

interface SidebarSectionItemsProps {
  children: ReactNode
}

const SidebarSectionRoot: FC<{ children: ReactNode }> = ({ children }) => {
  return <div className="flex flex-col gap-2">{children}</div>
}

const SidebarSectionTitle: FC<SidebarSectionTitleProps> = ({ text }) => {
  return <DividerWithText text={text} />
}

const SidebarSectionItems: FC<SidebarSectionItemsProps> = ({ children }) => {
  return <div className="flex flex-col gap-1">{children}</div>
}

const SidebarSection = Object.assign(SidebarSectionRoot, {
  Title: SidebarSectionTitle,
  Items: SidebarSectionItems
})

export default SidebarSection
