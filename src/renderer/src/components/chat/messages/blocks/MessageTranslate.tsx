import { Divider } from '@cherrystudio/ui'
import { Languages } from 'lucide-react'
import type { FC } from 'react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { BeatLoader } from 'react-spinners'

import type { MarkdownSource } from '../markdown/Markdown'
import Markdown from '../markdown/Markdown'

interface Props {
  block: MarkdownSource & { content: string }
}

const MessageTranslate: FC<Props> = ({ block }) => {
  const { t } = useTranslation()

  return (
    <Fragment>
      <div className="relative mb-2.5">
        <Divider />
        <div className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 bg-(--color-background) px-2">
          <Languages size={14} className="text-(--color-text-2)" />
        </div>
      </div>
      {!block.content || block.content === t('translate.processing') ? (
        <div className="-mt-1.25 mb-1.25 flex h-8 flex-row items-center">
          <BeatLoader color="var(--color-text-1)" size={8} speedMultiplier={0.8} />
        </div>
      ) : (
        <Markdown block={block} />
      )}
    </Fragment>
  )
}

export default MessageTranslate
