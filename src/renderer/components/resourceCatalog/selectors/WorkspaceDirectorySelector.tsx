import { useTranslation } from 'react-i18next'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'

export function WorkspaceDirectorySelector({
  directories,
  value,
  onValueChange
}: {
  /** Main directory first, followed by the additional workspace directories. */
  directories: readonly string[]
  value: string
  onValueChange: (directory: string) => void
}) {
  const { t } = useTranslation()

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        size="sm"
        className="w-full min-w-0"
        title={value}
        aria-label={t('agent.session.workspace_selector.placeholder')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-w-[min(40rem,90vw)]">
        {directories.map((directory, index) => (
          <SelectItem key={directory} value={directory} title={directory}>
            <span className="truncate">{directory}</span>
            {index === 0 ? (
              <span className="shrink-0 text-muted-foreground">{t('agent.session.workspace_edit.main_directory')}</span>
            ) : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
