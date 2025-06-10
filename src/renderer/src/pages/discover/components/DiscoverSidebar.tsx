import { SubCategoryItem } from '@renderer/types/cherryStore'
import { Badge } from '@renderer/ui/badge'
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuSubItem,
  SidebarProvider
} from '@renderer/ui/sidebar'

import { InternalCategory } from '../hooks/useDiscoverCategories'

interface DiscoverSidebarProps {
  activeCategory: InternalCategory | undefined
  selectedSubcategory: string
  onSelectSubcategory: (subcategoryId: string, row?: SubCategoryItem) => void
}

export default function DiscoverSidebar({
  activeCategory,
  selectedSubcategory,
  onSelectSubcategory
}: DiscoverSidebarProps) {
  if (!activeCategory) {
    return (
      <Sidebar className="absolute top-0 left-0 h-full border-r">
        <SidebarContent>
          <p className="p-4 text-sm text-gray-500">No active category selected.</p>
        </SidebarContent>
      </Sidebar>
    )
  }

  return (
    <SidebarProvider className="relative h-full min-h-full w-full">
      <Sidebar className="absolute top-0 left-0 h-full border-r">
        <SidebarContent>
          <SidebarMenu>
            {activeCategory.items &&
              activeCategory.items.length > 0 &&
              activeCategory.items.map((subItem) => (
                <SidebarMenuSubItem key={subItem.id}>
                  <SidebarMenuButton
                    isActive={subItem.id === selectedSubcategory}
                    onClick={() => {
                      onSelectSubcategory(subItem.id, subItem)
                    }}
                    size="sm">
                    <span className="truncate">{subItem.name}</span>
                    {typeof subItem.count === 'number' && (
                      <Badge variant="secondary" className="ml-auto shrink-0">
                        {subItem.count}
                      </Badge>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuSubItem>
              ))}
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  )
}
