import { InfoTooltip, Textarea } from '@cherrystudio/ui'
import { parseMatchPattern } from '@renderer/utils/blacklistMatchPattern'
import { debounce, isEqual } from 'lodash'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useWebSearchSettings } from '../hooks/useWebSearchSettings'
import { WebSearchSettingsBadge, WebSearchSettingsHint, WebSearchSettingsSection } from './WebSearchSettingsLayout'

function parseBlacklistInput(blacklist: string) {
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

  return { hasError, validDomains }
}

const BlacklistSettings: FC = () => {
  const [errFormat, setErrFormat] = useState(false)
  const [blacklistInput, setBlacklistInput] = useState('')
  const { excludeDomains, setExcludeDomains } = useWebSearchSettings()
  const { t } = useTranslation()
  const debouncedSetExcludeDomains = useMemo(
    () =>
      debounce((domains: string[]) => {
        void setExcludeDomains(domains)
      }, 300),
    [setExcludeDomains]
  )

  useEffect(() => {
    if (excludeDomains) {
      setBlacklistInput(excludeDomains.join('\n'))
    }
  }, [excludeDomains])

  useEffect(() => {
    const { hasError, validDomains } = parseBlacklistInput(blacklistInput)
    setErrFormat(hasError)

    if (hasError) {
      debouncedSetExcludeDomains.cancel()
      return
    }

    if (!isEqual(validDomains, excludeDomains ?? [])) {
      debouncedSetExcludeDomains(validDomains)
    }

    return () => debouncedSetExcludeDomains.cancel()
  }, [blacklistInput, debouncedSetExcludeDomains, excludeDomains])

  return (
    <WebSearchSettingsSection
      title={
        <span className="inline-flex items-center gap-1.5">
          {t('settings.tool.websearch.blacklist')}
          <InfoTooltip
            placement="right"
            content={t('settings.tool.websearch.blacklist_description')}
            iconProps={{
              size: 16,
              color: 'var(--color-icon)',
              className: 'cursor-pointer'
            }}
          />
        </span>
      }
      badge={
        <WebSearchSettingsBadge>
          {t('settings.tool.websearch.blacklist_rules', { count: excludeDomains?.length ?? 0 })}
        </WebSearchSettingsBadge>
      }>
      <div className="space-y-3">
        <Textarea.Input
          value={blacklistInput}
          onValueChange={setBlacklistInput}
          placeholder={t('settings.tool.websearch.blacklist_tooltip')}
          rows={6}
          hasError={errFormat}
          className="min-h-32 resize-none border-border/30 bg-foreground/3 px-2.5 py-2 text-[10px] shadow-none"
        />
        {errFormat && (
          <WebSearchSettingsHint tone="danger">{t('settings.tool.websearch.blacklist_tooltip')}</WebSearchSettingsHint>
        )}
      </div>
    </WebSearchSettingsSection>
  )
}

export default BlacklistSettings
