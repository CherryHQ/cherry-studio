import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { FieldHeader } from '../../FieldHeader'
import type { AgentFormState } from '../descriptor'

interface Props {
  form: AgentFormState
  onChange: (patch: Partial<AgentFormState>) => void
}

const PERMISSION_MODES = ['default', 'plan', 'acceptEdits', 'bypassPermissions'] as const

/**
 * Covers: configuration.permission_mode. Mirrors the legacy AgentSettings
 * "Permission Mode" tab — single responsibility, no other fields mixed in.
 */
const PermissionSection: FC<Props> = ({ form, onChange }) => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-1 text-base text-foreground">{t('library.config.agent.section.permission.title')}</h3>
        <p className="text-muted-foreground/80 text-xs">{t('library.config.agent.section.permission.desc')}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <FieldHeader
          label={t('library.config.agent.field.permission_mode.label')}
          hint={t('library.config.agent.field.permission_mode.help')}
        />
        <Select value={form.permissionMode || 'default'} onValueChange={(value) => onChange({ permissionMode: value })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERMISSION_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {t(`library.config.agent.field.permission_mode.option.${mode}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export default PermissionSection
