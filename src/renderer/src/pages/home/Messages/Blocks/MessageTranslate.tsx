import { Divider } from '@cherrystudio/ui'
import { LoadingIcon } from '@renderer/components/Icons'
import { Languages } from 'lucide-react'
import type { FC } from 'react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

import type { MarkdownSource } from '../../Markdown/Markdown'
import Markdown from '../../Markdown/Markdown'

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
        <LoadingIcon color="var(--color-text-2)" style={{ marginBottom: 15 }} />
      ) : (
        <Markdown block={block} />
      )}
    </Fragment>
  )
}

export default MessageTranslate
