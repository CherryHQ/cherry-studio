import { Alert, Button, Textarea } from '@cherrystudio/ui'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { t } from 'i18next'
import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '../..'
import { parseWebSearchBlacklistInput } from '../utils/webSearchBlacklist'

const BlacklistSettings: FC = () => {
  const { theme } = useTheme()
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
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.tool.websearch.blacklist')}</SettingTitle>
      <SettingDivider />
      <SettingRow className="pt-2 pb-3">
        <SettingRowTitle className="text-foreground-muted leading-5">
          {t('settings.tool.websearch.blacklist_description')}
          <span className="ml-2 rounded-md bg-muted px-1.5 py-px font-medium text-foreground-muted text-xs leading-tight">
            {excludeDomains.length}
          </span>
        </SettingRowTitle>
      </SettingRow>
      <Textarea.Input
        value={blacklistInput}
        onChange={(e) => setBlacklistInput(e.target.value)}
        placeholder={t('settings.tool.websearch.blacklist_tooltip')}
        className="max-h-48 min-h-28 rounded-lg text-sm leading-5 shadow-none"
        rows={4}
      />
      <div className="mt-2.5 flex justify-end">
        <Button type="button" size="sm" variant="outline" onClick={() => void updateManualBlacklist(blacklistInput)}>
          {t('common.save')}
        </Button>
      </div>
      {errFormat && <Alert className="mt-2.5" message={t('settings.tool.websearch.blacklist_tooltip')} type="error" />}
    </SettingGroup>
  )
}
export default BlacklistSettings
