import { Button, Textarea } from '@cherrystudio/ui'
import { parseMatchPattern } from '@renderer/utils/blacklistMatchPattern'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useWebSearchSettings } from '../hooks/useWebSearchSettings'
import { WebSearchSettingsHint, WebSearchSettingsSection } from './WebSearchSettingsLayout'

const BlacklistSettings: FC = () => {
  const [errFormat, setErrFormat] = useState(false)
  const [blacklistInput, setBlacklistInput] = useState('')
  const { excludeDomains, setExcludeDomains } = useWebSearchSettings()
  const { t } = useTranslation()

  useEffect(() => {
    if (excludeDomains) {
      setBlacklistInput(excludeDomains.join('\n'))
    }
  }, [excludeDomains])

  function updateManualBlacklist(blacklist: string) {
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
      }

      const parsed = parseMatchPattern(trimmedDomain)
      if (parsed === null) {
        return true
      }

      validDomains.push(trimmedDomain)
      return false
    })

    setErrFormat(hasError)
    if (hasError) return

    void setExcludeDomains(validDomains)
    window.toast.info({
      title: t('message.save.success.title'),
      timeout: 4000
    })
  }

  return (
    <WebSearchSettingsSection
      title={t('settings.tool.websearch.blacklist')}
      description={t('settings.tool.websearch.blacklist_description')}>
      <div className="space-y-3">
        <Textarea.Input
          value={blacklistInput}
          onValueChange={setBlacklistInput}
          placeholder={t('settings.tool.websearch.blacklist_tooltip')}
          rows={6}
          hasError={errFormat}
          className="min-h-32"
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button onClick={() => updateManualBlacklist(blacklistInput)}>{t('common.save')}</Button>
          {errFormat && (
            <WebSearchSettingsHint tone="danger">
              {t('settings.tool.websearch.blacklist_tooltip')}
            </WebSearchSettingsHint>
          )}
        </div>
      </div>
    </WebSearchSettingsSection>
  )
}

export default BlacklistSettings
