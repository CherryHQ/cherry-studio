import { Alert, Button, Textarea } from '@cherrystudio/ui'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { parseMatchPattern } from '@renderer/utils/blacklistMatchPattern'
import { t } from 'i18next'
import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const BlacklistSettings: FC = () => {
  const [errFormat, setErrFormat] = useState(false)
  const [blacklistInput, setBlacklistInput] = useState('')
  const { excludeDomains, setExcludeDomains } = useWebSearchSettings()
  const { theme } = useTheme()

  useEffect(() => {
    if (excludeDomains) {
      setBlacklistInput(excludeDomains.join('\n'))
    }
  }, [excludeDomains])

  async function updateManualBlacklist(blacklist: string) {
    const blacklistDomains = blacklist.split('\n').filter((url) => url.trim() !== '')
    const validDomains: string[] = []
    const hasError = blacklistDomains.some((domain) => {
      const trimmedDomain = domain.trim()
      if (trimmedDomain.startsWith('/') && trimmedDomain.endsWith('/')) {
        try {
          const regexPattern = trimmedDomain.slice(1, -1)
          new RegExp(regexPattern, 'i')
          validDomains.push(trimmedDomain)
          return false
        } catch {
          return true
        }
      } else {
        const parsed = parseMatchPattern(trimmedDomain)
        if (parsed === null) {
          return true
        }
        validDomains.push(trimmedDomain)
        return false
      }
    })

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
