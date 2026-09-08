import { Divider, type MarkdownSource, NormalTooltip } from '@cherrystudio/ui'
import { Languages, Trash } from 'lucide-react'
import type { FC } from 'react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { BeatLoader } from 'react-spinners'

import ChatMarkdown from '../markdown/ChatMarkdown'

interface Props {
  block: MarkdownSource & { content: string }
  onDelete?: () => void
}

const MessageTranslate: FC<Props> = ({ block, onDelete }) => {
  const { t } = useTranslation()

  // Render Markdown unconditionally so it mounts at content="" the moment
  // the overlay seed lands. The smooth-stream pipeline inside Markdown then
  // typewrites every delta from chunk 1 onward — gating Markdown behind
  // `!block.content` skipped the typewriter for the first chunk because
  // `useState(block.content)` captured the chunk-1 text as its initial
  // state (no `addChunk` ever ran for it). BeatLoader stays as a
  // co-existing indicator until the first delta arrives.
  const isAwaitingFirstChunk = !block.content || block.content === t('translate.processing')

  return (
    <Fragment>
      <div className="my-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <Divider className="my-0" aria-hidden />
        <Languages size={14} className="text-muted-foreground" />
        <div className="flex items-center">
          <Divider className="my-0 flex-1" aria-hidden />
          {onDelete && (
            <NormalTooltip content={t('translate.close')} side="top">
              <button
                type="button"
                onClick={onDelete}
                className="flex items-center px-2 text-muted-foreground transition-colors hover:text-foreground">
                <Trash size={14} />
              </button>
            </NormalTooltip>
          )}
        </div>
      </div>
      {isAwaitingFirstChunk && (
        <div className="-mt-1.25 mb-1.25 flex h-8 flex-row items-center">
          <BeatLoader color="var(--foreground)" size={8} speedMultiplier={0.8} />
        </div>
      )}
      <ChatMarkdown block={block} />
    </Fragment>
  )
}

export default MessageTranslate
