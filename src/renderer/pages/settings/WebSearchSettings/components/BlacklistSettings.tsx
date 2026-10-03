import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button, Textarea } from '@cherrystudio/ui'
import { SettingGroup, SettingSubtitle } from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { toast } from '@renderer/services/toast'

import { useWebSearchPersist } from '../hooks/useWebSearchPersist'
import { parseWebSearchBlacklistInput } from '../utils/webSearchBlacklist'

interface Props {
  variant?: 'card' | 'plain'
}

const BlacklistSettings: FC<Props> = ({ variant = 'card' }) => {
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
      toast.info({
        title: t('message.save.success.title'),
        timeout: 4000,
        icon: <Info className="size-4" />
      })
    }
  }

  return (
    <SettingGroup theme={theme} variant={variant}>
      <div className="flex min-h-6 items-center">
        <SettingSubtitle>{t('settings.tool.websearch.blacklist')}</SettingSubtitle>
      </div>
      <div className="relative mt-2.5">
        <Textarea.Input
          aria-label={t('settings.tool.websearch.blacklist')}
          value={blacklistInput}
          onChange={(e) => setBlacklistInput(e.target.value)}
          placeholder={t('settings.tool.websearch.blacklist_tooltip')}
          className="max-h-32 min-h-20 rounded-lg pr-20 text-sm leading-5 shadow-none"
          rows={3}
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
