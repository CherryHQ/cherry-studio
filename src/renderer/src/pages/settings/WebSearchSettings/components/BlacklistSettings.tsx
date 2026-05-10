import { Alert, Button, Textarea } from '@cherrystudio/ui'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { t } from 'i18next'
import { Info, Save } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'

import { parseWebSearchBlacklistInput } from '../utils/webSearchBlacklist'
import { Field } from './Field'
import { SettingsSection } from './SettingsSection'

const BlacklistSettings: FC = () => {
  const [errFormat, setErrFormat] = useState(false)
  const [blacklistInput, setBlacklistInput] = useState('')
  const { excludeDomains, setExcludeDomains } = useWebSearchSettings()

  useEffect(() => {
    if (excludeDomains) {
      setBlacklistInput(excludeDomains.join('\n'))
    }
  }, [excludeDomains])

  async function updateManualBlacklist(blacklist: string) {
    const { validDomains, hasError } = parseWebSearchBlacklistInput(blacklist)

    setErrFormat(hasError)
    if (hasError) return

    await setExcludeDomains(validDomains)
    window.toast.info({
      title: t('message.save.success.title'),
      timeout: 4000,
      icon: <Info className="size-4" />
    })
  }

  return (
    <SettingsSection
      title={t('settings.tool.websearch.blacklist')}
      badge={
        <span className="rounded-md bg-emerald-500/10 px-1.5 py-px font-medium text-emerald-500 text-xs leading-tight">
          {excludeDomains.length}
        </span>
      }>
      <Field label={t('settings.tool.websearch.blacklist_description')}>
        <Textarea.Input
          value={blacklistInput}
          onChange={(e) => setBlacklistInput(e.target.value)}
          placeholder={t('settings.tool.websearch.blacklist_tooltip')}
          className="max-h-48 min-h-28 rounded-lg border-border/30 bg-foreground/[0.03] font-mono text-foreground/60 text-xs leading-tight shadow-none placeholder:text-xs md:text-xs md:placeholder:text-xs"
          rows={4}
        />
      </Field>
      <div className="mt-2.5 flex justify-end">
        <Button
          type="button"
          size="sm"
          className="h-7 bg-emerald-500 px-3 text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-white dark:hover:bg-emerald-600"
          onClick={() => void updateManualBlacklist(blacklistInput)}>
          <Save className="size-3" />
          {t('common.save')}
        </Button>
      </div>
      {errFormat && <Alert className="mt-2.5" message={t('settings.tool.websearch.blacklist_tooltip')} type="error" />}
    </SettingsSection>
  )
}
export default BlacklistSettings
