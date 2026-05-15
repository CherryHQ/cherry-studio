import { Button, Input, RowFlex } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { FolderIcon as NutstoreFolderIcon } from '@renderer/components/Icons/NutstoreIcons'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface NewFolderProps {
  onConfirm: (name: string) => void
  onCancel: () => void
  className?: string
}

const logger = loggerService.withContext('NutstorePathSelector')
const folderIconClassName = 'h-10 w-10 shrink-0'

function NewFolder(props: NewFolderProps) {
  const { onConfirm, onCancel } = props
  const [name, setName] = useState('')
  const { t } = useTranslation()

  return (
    <div className={`flex items-center gap-2 px-1 ${props.className ?? ''}`}>
      <NutstoreFolderIcon className={folderIconClassName} />
      <Input type="text" className="flex-1" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      <Button size="sm" onClick={() => onConfirm(name)}>
        {t('settings.data.nutstore.new_folder.button.confirm')}
      </Button>
      <Button size="sm" variant="outline" onClick={() => onCancel()}>
        {t('settings.data.nutstore.new_folder.button.cancel')}
      </Button>
    </div>
  )
}

interface FolderProps {
  name: string
  path: string
  onClick: (path: string) => void
}

function Folder(props: FolderProps) {
  return (
    <div
      className="flex max-w-full cursor-pointer items-center gap-2 px-1 transition-colors hover:bg-accent"
      onClick={() => props.onClick(props.path)}>
      <NutstoreFolderIcon className={folderIconClassName} />
      <span className="min-w-0 flex-1 truncate">{props.name}</span>
    </div>
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
          logger.error('Error fetching files:', error)
          window.modal.error({
            content: error.message,
            centered: true
          })
        }
      }
    }
    void fetchFiles()
  }, [props.path, props.fs])

  return (
    <>
      {folders.map((folder) => (
        <Folder key={folder.path} name={folder.basename} path={folder.path} onClick={() => props.onClick(folder)} />
      ))}
    </>
  )
}

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
      <div className="flex flex-col gap-4">
        <div className="h-[300px] overflow-hidden">
          <div className="flex h-full flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {showNewFolder && (
              <NewFolder className="mt-1" onConfirm={handleNewFolder} onCancel={() => setShowNewFolder(false)} />
            )}
            <FileList path={cwd ?? ''} fs={props.fs} onClick={(f) => enter(f.path)} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span>{t('settings.data.nutstore.pathSelector.currentPath')}</span>
          <span className="break-all">{cwd ?? '/'}</span>
        </div>
      </div>
      <NustorePathSelectorFooter
        returnPrev={pop}
        mkdir={() => setShowNewFolder(true)}
        cancel={props.onCancel}
        confirm={() => props.onConfirm(cwd ?? '')}
      />
    </>
  )
}

interface FooterProps {
  returnPrev: () => void
  mkdir: () => void
  cancel: () => void
  confirm: () => void
}

export function NustorePathSelectorFooter(props: FooterProps) {
  const { t } = useTranslation()
  return (
    <RowFlex className="mt-3 justify-between bg-transparent p-0">
      <RowFlex className="items-center gap-2">
        <Button variant="outline" onClick={props.returnPrev}>
          {t('settings.data.nutstore.pathSelector.return')}
        </Button>
        <Button size="sm" variant="ghost" onClick={props.mkdir}>
          {t('settings.data.nutstore.new_folder.button.label')}
        </Button>
      </RowFlex>
      <RowFlex className="items-center gap-2">
        <Button variant="outline" onClick={props.cancel}>
          {t('settings.data.nutstore.new_folder.button.cancel')}
        </Button>
        <Button onClick={props.confirm}>{t('backup.confirm.button')}</Button>
      </RowFlex>
    </RowFlex>
  )
}
