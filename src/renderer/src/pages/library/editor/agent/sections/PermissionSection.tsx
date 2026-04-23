import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

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
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h3 className="mb-1 text-[14px] text-foreground">{t('library.config.agent.section.permission.title')}</h3>
        <p className="text-[10px] text-muted-foreground/55">{t('library.config.agent.section.permission.desc')}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] text-muted-foreground/60">
          {t('library.config.agent.field.permission_mode.label')}
        </label>
        <Select value={form.permissionMode || 'default'} onValueChange={(value) => onChange({ permissionMode: value })}>
          <SelectTrigger className="rounded-xl border-border/20 bg-accent/10 text-[11px] hover:border-border/40">
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
        <span className="text-[9px] text-muted-foreground/40">
          {t('library.config.agent.field.permission_mode.help')}
        </span>
      </div>
    </div>
  )
}

export default PermissionSection
