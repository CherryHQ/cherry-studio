import { Alert, Button, Textarea } from '@cherrystudio/ui'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingTitle } from '../..'
import { useWebSearchPersist } from '../hooks/useWebSearchPersist'
import { parseWebSearchBlacklistInput } from '../utils/webSearchBlacklist'

const BlacklistSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const [invalidEntries, setInvalidEntries] = useState<string[]>([])
  const { excludeDomains, setExcludeDomains } = useWebSearchSettings()
  const savedBlacklistInput = excludeDomains.join('\n')
  const [blacklistInput, setBlacklistInput] = useState(savedBlacklistInput)
  const [blacklistBaseline, setBlacklistBaseline] = useState(savedBlacklistInput)
  const blacklistDirty = blacklistInput !== blacklistBaseline
  const persist = useWebSearchPersist()

  useEffect(() => {
    if (!blacklistDirty) {
      setBlacklistInput(savedBlacklistInput)
    }
    setBlacklistBaseline(savedBlacklistInput)
  }, [blacklistDirty, savedBlacklistInput])

  async function updateManualBlacklist(blacklist: string) {
    const { validDomains, invalidEntries: parsedInvalidEntries } = parseWebSearchBlacklistInput(blacklist)

    setInvalidEntries(parsedInvalidEntries)
    if (parsedInvalidEntries.length > 0) return

    const saved = await persist(() => setExcludeDomains(validDomains), 'Failed to save web search blacklist')
    if (saved.ok) {
      const nextBlacklistInput = validDomains.join('\n')

      setBlacklistInput(nextBlacklistInput)
      setBlacklistBaseline(nextBlacklistInput)
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
      <div className="space-y-2 py-2.5">
        <div className="flex items-center gap-2 text-foreground-muted text-sm leading-5">
          <span>{t('settings.tool.websearch.blacklist_description')}</span>
          <span className="rounded-md bg-muted px-1.5 py-px font-medium text-foreground-muted text-xs leading-tight">
            {excludeDomains.length}
          </span>
        </div>
        <div className="relative">
          <Textarea.Input
            value={blacklistInput}
            onChange={(e) => setBlacklistInput(e.target.value)}
            placeholder={t('settings.tool.websearch.blacklist_tooltip')}
            className="max-h-40 min-h-28 rounded-lg pr-20 text-sm leading-5 shadow-none"
            rows={4}
          />
          {blacklistDirty && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="absolute right-2 bottom-2 h-7 px-2.5"
              onClick={() => void updateManualBlacklist(blacklistInput)}>
              {t('common.save')}
            </Button>
          )}
        </div>
      </div>
      {invalidEntries.length > 0 && (
        <Alert
          className="mt-1"
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
