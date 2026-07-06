import type { TooltipProps } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { CommandTooltip } from '@renderer/components/command'
import { SidebarCollapseIcon, SidebarExpandIcon } from '@renderer/components/icons/SidebarToggleIcons'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { t } from 'i18next'
import type { ComponentProps } from 'react'

type ConversationSidebarToggleButtonProps = Omit<
  ComponentProps<typeof NavbarIcon>,
  'aria-pressed' | 'children' | 'onClick' | 'tone'
> & {
  onSidebarToggle?: () => void
  sidebarOpen?: boolean
  tooltipDelay?: TooltipProps['delay']
  tooltipPlacement?: TooltipProps['placement']
}

export function ConversationSidebarToggleButton({
  onSidebarToggle,
  sidebarOpen,
  tooltipDelay = 800,
  tooltipPlacement,
  ...buttonProps
}: ConversationSidebarToggleButtonProps) {
  const [preferredShowSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const showSidebar = sidebarOpen ?? preferredShowSidebar
  const label = showSidebar ? t('navbar.hide_sidebar') : t('navbar.show_sidebar')
  const ToggleIcon = showSidebar ? SidebarCollapseIcon : SidebarExpandIcon

  const toggleShowSidebar = () => {
    if (onSidebarToggle) {
      onSidebarToggle()
      return
    }

    void setShowSidebar(!showSidebar)
  }

  return (
    <CommandTooltip command="app.sidebar.toggle" label={label} placement={tooltipPlacement} delay={tooltipDelay}>
      <NavbarIcon
        tone="conversation"
        aria-label={label}
        aria-pressed={showSidebar}
        onClick={toggleShowSidebar}
        {...buttonProps}>
        <ToggleIcon />
      </NavbarIcon>
    </CommandTooltip>
  )
}
