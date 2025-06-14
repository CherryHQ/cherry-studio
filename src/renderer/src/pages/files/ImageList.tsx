import { FileType } from '@renderer/types'
import { Image, Row } from 'antd'
import { memo } from 'react'

import ImageItem from './ImageItem'

interface ImageListProps {
  files?: FileType[]
}

const ImageList: React.FC<ImageListProps> = ({ files }) => {
  return (
    <div style={{ padding: 16, overflowY: 'auto' }}>
      <Image.PreviewGroup>
        <Row gutter={[16, 16]}>{files?.map((file) => <ImageItem key={file.id} file={file}></ImageItem>)}</Row>
      </Image.PreviewGroup>
    </div>
  )
}

export default memo(ImageList)
