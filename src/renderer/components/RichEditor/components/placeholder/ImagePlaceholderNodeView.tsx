import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { Image as ImageIcon } from 'lucide-react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import PlaceholderBlock from './PlaceholderBlock'

const ImagePlaceholderNodeView: React.FC<NodeViewProps> = ({ deleteNode, editor }) => {
  const { t } = useTranslation()

  const handleClick = useCallback(() => {
    const event = new CustomEvent('openImageUploader', {
      detail: {
        onImageSelect: (imageUrl: string) => {
          if (imageUrl.trim()) {
            deleteNode()
            editor.chain().focus().setImage({ src: imageUrl }).run()
          } else {
            deleteNode()
          }
        },
        onCancel: () => deleteNode()
      }
    })
    window.dispatchEvent(event)
  }, [editor, deleteNode])

  return (
    <NodeViewWrapper className="image-placeholder-wrapper">
      <PlaceholderBlock
        icon={<ImageIcon size={20} className="lucide-custom" />}
        message={t('richEditor.image.placeholder')}
        onClick={handleClick}
      />
    </NodeViewWrapper>
  )
}

export default ImagePlaceholderNodeView
