import ImageViewer from '@renderer/components/ImageViewer'
import { FileMetadata, KnowledgeSearchResult } from '@renderer/types'
import React, { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButtonContainer, KnowledgeItemMetadata } from './components'

interface Props {
  item: KnowledgeSearchResult & {
    file: FileMetadata | null
  }
}

const ImageItem: FC<Props> = ({ item }) => {
  const { t } = useTranslation()

  // For images, we'll copy the source URL or file path
  const textToCopy = item.file?.origin_name || item.metadata.source || 'Image'

  // Combine pageContent (base64 data) with mime type to create complete base64 URL
  const getImageSrc = () => {
    if (!item.pageContent) return ''

    // Combine mime type with base64 data
    const mimeType = item.metadata.mime || 'image/png'
    return `data:${mimeType};base64,${item.pageContent}`
  }

  const imageSrc = getImageSrc()

  return (
    <>
      <KnowledgeItemMetadata item={item} />
      <CopyButtonContainer textToCopy={textToCopy} tooltipTitle={t('common.copy')} />
      {imageSrc && (
        <ImageViewer
          src={imageSrc}
          style={{
            maxHeight: 'min(500px, 50vh)',
            padding: 0,
            borderRadius: 8,
            marginTop: 8
          }}
        />
      )}
    </>
  )
}

export default React.memo(ImageItem)
