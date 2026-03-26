import type { AgentEntity, AgentSessionEntity } from '@renderer/types'
import { cn } from '@renderer/utils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { Folder } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

type SessionWorkspaceMetaProps = {
  agent: AgentEntity
  session: AgentSessionEntity
}

const SessionWorkspaceMeta = ({ agent, session }: SessionWorkspaceMetaProps) => {
  const { t } = useTranslation()

  if (!session || !agent) {
    return null
  }

  const firstAccessiblePath = session.accessible_paths?.[0]

  const getLastFolderName = (path: string): string => {
    const trimmedPath = path.replace(/[/\\]+$/, '')
    const parts = trimmedPath.split(/[/\\]/)
    return parts[parts.length - 1] || path
  }

  const infoItems: ReactNode[] = []

  const InfoTag = ({
    text,
    tooltip,
    className,
    onClick
  }: {
    text: string
    tooltip?: string
    className?: string
    onClick?: (e: React.MouseEvent) => void
  }) => (
    <div
      className={cn(
        'flex items-center gap-1.5 text-foreground-500 text-xs dark:text-foreground-400',
        onClick !== undefined ? 'cursor-pointer' : undefined,
        className
      )}
      title={tooltip ?? text}
      onClick={onClick}>
      <Folder className="h-3.5 w-3.5 shrink-0" />
      <span className="block truncate">{text}</span>
    </div>
  )

  if (firstAccessiblePath) {
    infoItems.push(
      <InfoTag
        key="path"
        text={getLastFolderName(firstAccessiblePath)}
        tooltip={firstAccessiblePath}
        className="max-w-60 transition-colors hover:border-primary hover:text-primary"
        onClick={() => {
          window.api.file
            .openPath(firstAccessiblePath)
            .catch((e) =>
              window.toast.error(
                formatErrorMessageWithPrefix(e, t('files.error.open_path', { path: firstAccessiblePath }))
              )
            )
        }}
      />
    )
  }

  if (infoItems.length === 0) {
    return null
  }

  return <div className="ml-2 flex items-center gap-2">{infoItems}</div>
}

export default SessionWorkspaceMeta
