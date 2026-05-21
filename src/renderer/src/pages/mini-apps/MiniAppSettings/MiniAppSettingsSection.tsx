import type { FC, ReactNode } from 'react'

interface Props {
  title: string
  /** Right-aligned, lower-weight actions for this group (e.g. Swap / Reset). */
  actions?: ReactNode
  children: ReactNode
}

/**
 * A titled settings group inside the mini-app settings drawer: a group title
 * (with optional right-aligned actions) followed by composed content. Shared by
 * the "display management" and "preferences" groups.
 */
const MiniAppSettingsSection: FC<Props> = ({ title, actions, children }) => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center justify-between gap-2">
      <span className="font-semibold text-foreground text-sm">{title}</span>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
    {children}
  </div>
)

export default MiniAppSettingsSection
