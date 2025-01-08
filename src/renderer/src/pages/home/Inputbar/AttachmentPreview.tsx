import FileManager from '@renderer/services/FileManager'
import { FileType } from '@renderer/types'
import { Upload } from 'antd'
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
    <Container>
      <ContentContainer>
        <Upload
          listType={files.length > 20 ? 'text' : 'picture-card'}
          fileList={files.map((file) => ({
            uid: file.id,
            url: 'file://' + FileManager.getSafePath(file),
            status: 'done',
            name: file.name
          }))}
          onRemove={(item) => setFiles(files.filter((file) => item.uid !== file.id))}
        />
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: row;
  gap: 10px;
  padding: 10px 0;
  background: var(--color-background);
  border-top: 1px solid var(--color-border-mute);
`

const ContentContainer = styled.div`
  max-height: 40vh;
  width: 100%;
  overflow-y: auto;
  padding: 0 20px;
`

export default AttachmentPreview
