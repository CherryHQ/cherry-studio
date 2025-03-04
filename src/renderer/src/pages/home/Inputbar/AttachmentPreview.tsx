import FileManager from '@renderer/services/FileManager'
import { FileType } from '@renderer/types'
import { Upload as AntdUpload, UploadFile } from 'antd'
import { isEmpty } from 'lodash'
import { FC } from 'react'
import styled from 'styled-components'

interface Props {
  files: FileType[]
  setFiles: (files: FileType[]) => void
}

const AttachmentPreview: FC<Props> = ({ files, setFiles }) => {
  if (isEmpty(files)) {
    return null
  }

  return (
    <ContentContainer>
      <Upload
        listType={files.length > 20 ? 'text' : 'picture-card'}
        fileList={files.map(
          (file) =>
            ({
              uid: file.id,
              url: 'file://' + FileManager.getSafePath(file),
              status: 'done',
              name: file.name
            }) as UploadFile
        )}
        onRemove={(item) => setFiles(files.filter((file) => item.uid !== file.id))}
      />
    </ContentContainer>
  )
}

const ContentContainer = styled.div`
  max-height: 40vh;
  overflow-y: auto;
  width: 100%;
  padding: 10px 15px 0;
`

const Upload = styled(AntdUpload)`
  .ant-upload-list-item {
    background-color: var(--color-background);
  }
`

export default AttachmentPreview
