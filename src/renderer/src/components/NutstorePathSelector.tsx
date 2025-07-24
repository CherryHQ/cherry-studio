import { loggerService } from '@logger'
import { FolderIcon as NutstoreFolderIcon } from '@renderer/components/Icons/NutstoreIcons'
import { Button, Input } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { HStack } from './Layout'

interface NewFolderProps {
  onConfirm: (name: string) => void
  onCancel: () => void
  className?: string
}

const logger = loggerService.withContext('NutstorePathSelector')

const NewFolderContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
`

const FolderIcon = styled(NutstoreFolderIcon)`
  width: 40px;
  height: 40px;
`

function NewFolder(props: NewFolderProps) {
  const { onConfirm, onCancel } = props
  const [name, setName] = useState('')
  const { t } = useTranslation()

  return (
    <NewFolderContainer>
      <FolderIcon className={props.className}></FolderIcon>
      <Input type="text" style={{ flex: 1 }} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      <Button type="primary" size="small" onClick={() => onConfirm(name)}>
        {t('settings.data.nutstore.new_folder.button.confirm')}
      </Button>
      <Button type="default" size="small" onClick={() => onCancel()}>
        {t('settings.data.nutstore.new_folder.button.cancel')}
      </Button>
    </NewFolderContainer>
  )
}

interface FolderProps {
  name: string
  path: string
  onClick: (path: string) => void
}

const FolderContainer = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  max-width: 100%;
  padding: 0 4px;

  &:hover {
    background-color: var(--color-background-soft);
  }

  .nutstore-pathname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
`

function Folder(props: FolderProps) {
  return (
    <FolderContainer onClick={() => props.onClick(props.path)}>
      <FolderIcon></FolderIcon>
      <span className="nutstore-pathname">{props.name}</span>
    </FolderContainer>
  )
}

interface FileListProps {
  path: string
  fs: Nutstore.Fs
  onClick: (file: Nutstore.FileStat) => void
}

function FileList(props: FileListProps) {
  const [files, setFiles] = useState<Nutstore.FileStat[]>([])

  const folders = files.filter((file) => file.isDir).sort((a, b) => a.basename.localeCompare(b.basename, ['zh']))

  useEffect(() => {
    async function fetchFiles() {
      try {
        const items = await props.fs.ls(props.path)
        setFiles(items)
      } catch (error) {
        if (error instanceof Error) {
          logger.error('Error fetching files:', error as Error)
          window.modal.error({
            content: error.message,
            centered: true
          })
        }
      }
    }
    fetchFiles()
  }, [props.path, props.fs])

  return (
    <>
      {folders.map((folder) => (
        <Folder key={folder.path} name={folder.basename} path={folder.path} onClick={() => props.onClick(folder)} />
      ))}
    </>
  )
}

const SingleFileListContainer = styled.div`
  height: 300px;
  overflow: hidden;
  .scroll-container {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    scrollbar-width: none;
    &::-webkit-scrollbar {
      display: none;
    }
  }

  .new-folder {
    margin-top: 4px;
  }
`

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  .nutstore-current-path-container {
    display: flex;
    align-items: center;
    gap: 8px;
    .nutstore-current-path {
      word-break: break-all;
    }
  }

  .nutstore-path-operater {
    display: flex;
    align-items: center;
    gap: 8px;
  }
`

interface Props {
  fs: Nutstore.Fs
  onConfirm: (path: string) => void
  onCancel: () => void
}

export function NutstorePathSelector(props: Props) {
  const { t } = useTranslation()

  const [stack, setStack] = useState<string[]>(['/'])
  const [showNewFolder, setShowNewFolder] = useState(false)

  const cwd = stack.at(-1)

  const enter = useCallback((path: string) => {
    setStack((prev) => [...prev, path])
  }, [])

  const pop = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))
  }, [])

  const handleNewFolder = useCallback(
    async (name: string) => {
      const target = (cwd ?? '/') + (cwd && cwd !== '/' ? '/' : '') + name
      await props.fs.mkdirs(target)
      setShowNewFolder(false)
      enter(target)
    },
    [cwd, props.fs, enter]
  )

  return (
    <>
      <Container>
        <SingleFileListContainer>
          <div className="scroll-container">
            {showNewFolder && (
              <NewFolder className="new-folder" onConfirm={handleNewFolder} onCancel={() => setShowNewFolder(false)} />
            )}
            <FileList path={cwd ?? ''} fs={props.fs} onClick={(f) => enter(f.path)} />
          </div>
        </SingleFileListContainer>
        <div className="nutstore-current-path-container">
          <span>{t('settings.data.nutstore.pathSelector.currentPath')}</span>
          <span className="nutstore-current-path">{cwd ?? '/'}</span>
        </div>
      </Container>
      <NustorePathSelectorFooter
        returnPrev={pop}
        mkdir={() => setShowNewFolder(true)}
        cancel={props.onCancel}
        confirm={() => props.onConfirm(cwd ?? '')}
      />
    </>
  )
}

const FooterContainer = styled(HStack)`
  background: transparent;
  margin-top: 12px;
  padding: 0;
  border-top: none;
  border-radius: 0;
`

interface FooterProps {
  returnPrev: () => void
  mkdir: () => void
  cancel: () => void
  confirm: () => void
}

export function NustorePathSelectorFooter(props: FooterProps) {
  const { t } = useTranslation()
  return (
    <FooterContainer justifyContent="space-between">
      <HStack gap={8} alignItems="center">
        <Button onClick={props.returnPrev}>{t('settings.data.nutstore.pathSelector.return')}</Button>
        <Button size="small" type="link" onClick={props.mkdir}>
          {t('settings.data.nutstore.new_folder.button.label')}
        </Button>
      </HStack>
      <HStack gap={8} alignItems="center">
        <Button type="default" onClick={props.cancel}>
          {t('settings.data.nutstore.new_folder.button.cancel')}
        </Button>
        <Button type="primary" onClick={props.confirm}>
          {t('backup.confirm.button')}
        </Button>
      </HStack>
    </FooterContainer>
  )
}
