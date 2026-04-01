import { CloseOutlined, FileImageOutlined, FileOutlined } from '@ant-design/icons'
import type { FileMetadata } from '@renderer/types'
import { FileTypes } from '@renderer/types'
import { Tooltip } from 'antd'
import type { FC } from 'react'
import styled from 'styled-components'

interface PastedFilesPreviewProps {
  files: FileMetadata[]
  onRemove: (filePath: string) => void
}

const PastedFilesPreview: FC<PastedFilesPreviewProps> = ({ files, onRemove }) => {
  if (!files.length) return null

  return (
    <Container>
      {files.map((file) => (
        <FileChip key={file.path} className="nodrag">
          <IconWrapper>{file.type === FileTypes.IMAGE ? <FileImageOutlined /> : <FileOutlined />}</IconWrapper>
          <Tooltip title={file.name} placement="topLeft">
            <FileName>{file.name}</FileName>
          </Tooltip>
          <RemoveButton onClick={() => onRemove(file.path)}>
            <CloseOutlined />
          </RemoveButton>
        </FileChip>
      ))}
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 8px 0 2px;
`

const FileChip = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--color-background-opacity);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  max-width: 100%;
`

const IconWrapper = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
`

const FileName = styled.span`
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
`

const RemoveButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 2px;

  &:hover {
    color: var(--color-text);
  }
`

export default PastedFilesPreview
