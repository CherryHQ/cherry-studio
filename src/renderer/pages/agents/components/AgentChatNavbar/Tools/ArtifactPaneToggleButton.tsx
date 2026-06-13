import { Tooltip } from '@cherrystudio/ui'
import { RightSidebarCollapseIcon, RightSidebarExpandIcon } from '@renderer/components/Icons'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { t } from 'i18next'

interface ArtifactPaneToggleButtonProps {
  open: boolean
  onToggle: () => void
}

const ArtifactPaneToggleButton = ({ open, onToggle }: ArtifactPaneToggleButtonProps) => {
  return (
    <Tooltip content={t('agent.preview_pane.toggle')} delay={800}>
      <NavbarIcon
        tone="conversation"
        active={open}
        onClick={onToggle}
        aria-pressed={open}
        aria-label={t('agent.preview_pane.toggle')}
        data-state={open ? 'open' : 'closed'}>
        {open ? <RightSidebarCollapseIcon /> : <RightSidebarExpandIcon />}
      </NavbarIcon>
    </Tooltip>
  )
}

export default ArtifactPaneToggleButton
