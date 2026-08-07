import { Button } from '@cherrystudio/ui'
import { GitBranch } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface Props {
  /** Number of hidden messages continuing in another branch. */
  count: number
  /** Opens the branch tree panel. */
  onOpenBranches: () => void
}

/**
 * Footer notice shown at the end of the active message path when live
 * messages continue in another branch (e.g. after regenerating or editing a
 * mid-conversation message). Clicking it opens the branch tree panel so the
 * hidden conversation can be located or switched back to.
 */
function FollowingBranchNotice({ count, onOpenBranches }: Props) {
  const { t } = useTranslation()

  return (
    <div className="flex w-full justify-center px-4 py-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="following-branch-notice"
        onClick={onOpenBranches}
        className="h-auto rounded-full border-border bg-background/60 px-3.5 py-1.5 text-foreground-tertiary text-xs shadow-sm backdrop-blur-sm transition-colors hover:bg-background hover:text-foreground">
        <GitBranch className="mr-1.5 size-3.5 shrink-0 text-foreground-tertiary" aria-hidden="true" />
        <span>{t('chat.message.following_branch.notice', { count })}</span>
        <span className="ml-1.5 text-foreground-tertiary">·</span>
        <span className="ml-1.5 font-medium text-foreground-secondary">{t('chat.message.following_branch.open')}</span>
      </Button>
    </div>
  )
}

export default FollowingBranchNotice
