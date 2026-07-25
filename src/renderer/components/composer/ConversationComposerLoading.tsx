import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'

import ComposerControlsLoading from './ComposerControlsLoading'

export default function ConversationComposerLoading() {
  return (
    <NarrowLayout withSidePadding style={{ width: '100%' }}>
      <div className="w-full">
        <div className="inputbar relative z-2 flex flex-col pt-0">
          <div className="relative">
            <div
              aria-hidden="true"
              data-composer-inputbar=""
              data-conversation-composer-loading=""
              className="inputbar-container relative mb-3 rounded-[20px] border-[0.5px] border-border bg-card pt-2 shadow-[0_1px_5px_rgba(15,23,42,0.05)] dark:shadow-[0_1px_5px_rgba(0,0,0,0.14)]">
              <div data-composer-editor-frame="" className="h-[46px] min-w-0" />
              <div
                data-composer-toolbar=""
                className="relative z-2 flex h-10 shrink-0 flex-row justify-between gap-4 px-2 py-1.25">
                <div className="flex min-w-0 flex-1 items-center overflow-hidden">
                  <ComposerControlsLoading />
                </div>
                <div className="size-7.5 shrink-0 rounded-full bg-muted" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </NarrowLayout>
  )
}
