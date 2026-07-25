import { Skeleton } from '@cherrystudio/ui'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'

export default function ConversationComposerLoading() {
  return (
    <NarrowLayout withSidePadding>
      <div
        aria-hidden="true"
        data-composer-inputbar=""
        data-conversation-composer-loading=""
        className="mb-3 h-[104px] rounded-[20px] border-[0.5px] border-border bg-card px-3.5 pt-4 pb-2 shadow-[0_1px_5px_rgba(15,23,42,0.05)] dark:shadow-[0_1px_5px_rgba(0,0,0,0.14)]">
        <Skeleton className="h-3 w-2/5 rounded-sm" />
        <div className="mt-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="size-7 rounded-full" />
            <Skeleton className="size-7 rounded-full" />
            <Skeleton className="h-7 w-16 rounded-full" />
          </div>
          <Skeleton className="size-7 rounded-full" />
        </div>
      </div>
    </NarrowLayout>
  )
}
