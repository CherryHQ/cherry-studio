import { Alert, Button, Textarea } from '@cherrystudio/ui'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '../..'
import { useWebSearchPersist } from '../hooks/useWebSearchPersist'
import { parseWebSearchBlacklistInput } from '../utils/webSearchBlacklist'

const BlacklistSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const [invalidEntries, setInvalidEntries] = useState<string[]>([])
  const [blacklistInput, setBlacklistInput] = useState('')
  const { excludeDomains, setExcludeDomains } = useWebSearchSettings()
  const persist = useWebSearchPersist()

  useEffect(() => {
    if (excludeDomains) {
      setBlacklistInput(excludeDomains.join('\n'))
    }
  }, [excludeDomains])

  async function updateManualBlacklist(blacklist: string) {
    const { validDomains, invalidEntries: parsedInvalidEntries } = parseWebSearchBlacklistInput(blacklist)

    setInvalidEntries(parsedInvalidEntries)
    if (parsedInvalidEntries.length > 0) return

    const saved = await persist(() => setExcludeDomains(validDomains), 'Failed to save web search blacklist')
    if (saved.ok) {
      window.toast.info({
        title: t('message.save.success.title'),
        timeout: 4000,
        icon: <Info className="size-4" />
      })
    }
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
      {invalidEntries.length > 0 && (
        <Alert
          className="mt-2.5"
          message={t('settings.tool.websearch.blacklist_invalid_entries', {
            entries: invalidEntries.join(', ')
          })}
          type="error"
        />
      )}
    </SettingGroup>
  )
}
export default BlacklistSettings
