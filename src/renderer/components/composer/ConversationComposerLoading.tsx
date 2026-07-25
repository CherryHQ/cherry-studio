import { cn } from '@cherrystudio/ui/lib/utils'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import { usePreference } from '@renderer/data/hooks/usePreference'

import ComposerControlsLoading from './ComposerControlsLoading'
import { getCompactComposerEditorMinHeight, getComposerEditorMinHeight } from './useComposerEditorFrameSizing'

interface ConversationComposerLoadingProps {
  forceNarrowLayout?: boolean
  /** Mirror the real composer's compact single-row layout, so the dock keeps its height across the swap. */
  compact?: boolean
}

export default function ConversationComposerLoading({
  forceNarrowLayout = false,
  compact = false
}: ConversationComposerLoadingProps) {
  const [narrowMode] = usePreference('chat.narrow_mode')
  const [fontSize] = usePreference('chat.message.font_size')
  // The dock's bottom inset is measured off `[data-composer-inputbar]`, so this
  // frame has to track the real one — its height follows the chat font size.
  const editorFrameHeight = compact ? getCompactComposerEditorMinHeight(fontSize) : getComposerEditorMinHeight(fontSize)

  return (
    <NarrowLayout narrowMode={forceNarrowLayout || narrowMode} withSidePadding style={{ width: '100%' }}>
      <div className="w-full">
        <div className="inputbar relative z-2 flex flex-col pt-0">
          <div className="relative">
            <div
              aria-hidden="true"
              data-composer-inputbar=""
              data-conversation-composer-loading=""
              className={cn(
                'inputbar-container relative mb-3 rounded-[20px] border-[0.5px] border-border bg-card shadow-sm',
                compact ? 'pt-0' : 'pt-2'
              )}>
              {compact ? (
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 px-2 py-1">
                  <ComposerControlsLoading compact />
                  <div data-composer-editor-frame="" className="min-w-0" style={{ height: editorFrameHeight }} />
                  <span
                    data-composer-static-send=""
                    className="iconfont icon-ic_send shrink-0 text-[22px] text-foreground/45"
                  />
                </div>
              ) : (
                <>
                  <div data-composer-editor-frame="" className="min-w-0" style={{ height: editorFrameHeight }} />
                  <div
                    data-composer-toolbar=""
                    className="relative z-2 flex h-10 shrink-0 flex-row justify-between gap-4 px-2 py-1.25">
                    <div className="flex min-w-0 flex-1 items-center overflow-hidden">
                      <ComposerControlsLoading />
                    </div>
                    <span
                      data-composer-static-send=""
                      className="iconfont icon-ic_send mt-px mr-0.5 shrink-0 text-[22px] text-foreground/45"
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </NarrowLayout>
  )
}
