import BranchDetail from './BranchDetail'
import BranchTab from './BranchTab'
import type { Branch } from './types'

type ForkStatus = 'idle' | 'creating' | 'error'

interface Props {
  /** The branch this accordion item represents. */
  branch: Branch
  /** 0-based creation order; shown as index+1 in the header badge. */
  index: number
  /** Collapsed = header only; expanded = header + content directly below it. */
  collapsed: boolean
  forkStatus: ForkStatus
  forkErrorMessage?: string
  /** Header chevron / snippet click → toggle this branch (host also handles locate). */
  onToggleCollapse: () => void
  /** Header X OR compose Cancel → close this branch. */
  onClose: () => void
  /** Compose-state submit → fork this branch. */
  onCreate: (followUp: string) => void
  /** Conversation-state submit → send a follow-up to this branch's topic. */
  onSendFollowUp: (followUp: string) => void
  /** P1-S3: toggle this branch's disposition pending ↔ kept. */
  onToggleKeep: () => void
}

/**
 * BranchAccordionItem — ONE branch's item in the single-region accordion
 * (P1-S2c-accordion). The header (`BranchTab`) and, when expanded, its content
 * (`BranchDetail`) render TOGETHER inside the SAME per-branch box — never split
 * into separate regions (that was the abandoned master/detail layout).
 *
 * This box is the `shrink-0` non-shrinkable flex child of the scroll region
 * (the S2c overlap fix lives here now): it keeps natural height so the region
 * scrolls instead of compressing it. Plain document flow — NO `position:
 * sticky`, NO `display: contents`; the header scrolls with its content.
 */
export default function BranchAccordionItem({
  branch,
  index,
  collapsed,
  forkStatus,
  forkErrorMessage,
  onToggleCollapse,
  onClose,
  onCreate,
  onSendFollowUp,
  onToggleKeep
}: Props) {
  return (
    <div
      className="flex shrink-0 flex-col rounded-md border border-border bg-background"
      data-testid={`branch-item-${branch.id}`}
      data-branch-item-id={branch.id}>
      <BranchTab
        branch={branch}
        index={index}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
        onClose={onClose}
      />
      {!collapsed && (
        <BranchDetail
          branch={branch}
          forkStatus={forkStatus}
          forkErrorMessage={forkErrorMessage}
          onCreate={onCreate}
          onSendFollowUp={onSendFollowUp}
          onClose={onClose}
          onToggleKeep={onToggleKeep}
        />
      )}
    </div>
  )
}
