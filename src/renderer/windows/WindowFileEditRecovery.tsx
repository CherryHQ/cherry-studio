import { FileEditRecovery } from '@renderer/components/FileEditSessionProvider'
import { useCache } from '@renderer/data/hooks/useCache'
import { useTabs } from '@renderer/hooks/tab'
import { AbsoluteFilePathSchema } from '@shared/types/file'

export function WindowFileEditRecovery() {
  const [, setActiveFilePath] = useCache('notes.active_file_path')
  const { openTab } = useTabs()

  return (
    <FileEditRecovery
      getReopenAction={(session) => {
        if (session.ownerId !== 'notes' || session.readError) return undefined
        return () => {
          setActiveFilePath(AbsoluteFilePathSchema.parse(session.locator))
          openTab('/app/notes')
        }
      }}
    />
  )
}
