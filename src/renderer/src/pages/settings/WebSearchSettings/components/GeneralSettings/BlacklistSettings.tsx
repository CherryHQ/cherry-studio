import { Button, Textarea } from '@cherrystudio/ui'
import { useBasicWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { parseDomains, validateDomains } from '@renderer/validators/blacklistValidator'
import { t } from 'i18next'
import { AlertCircle, Info } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'

const BlacklistSettings: FC = () => {
  const [errFormat, setErrFormat] = useState(false)
  const [blacklistInput, setBlacklistInput] = useState('')
  const { excludeDomains, setExcludeDomains } = useBasicWebSearchSettings()

  useEffect(() => {
    if (excludeDomains) {
      setBlacklistInput(excludeDomains.join('\n'))
    }
  }, [excludeDomains])

  function updateManualBlacklist(blacklist: string) {
    const domains = parseDomains(blacklist)
    const { valid, invalid } = validateDomains(domains)

    setErrFormat(invalid.length > 0)
    if (invalid.length > 0) return

    setExcludeDomains(valid)
    window.toast.info({
      title: t('message.save.success.title'),
      timeout: 4000,
      icon: <Info size={16} />
    })
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-2">
      <div>{t('settings.tool.websearch.blacklist')}</div>
      <div className="text-muted-foreground text-sm">{t('settings.tool.websearch.blacklist_description')}</div>
      <Textarea.Input
        value={blacklistInput}
        onValueChange={setBlacklistInput}
        placeholder={t('settings.tool.websearch.blacklist_tooltip')}
        rows={4}
        className="max-h-50 min-h-25 border-2 border-border"
      />
      <Button className="w-20 rounded-2xs" onClick={() => updateManualBlacklist(blacklistInput)}>
        {t('common.save')}
      </Button>
      {errFormat && (
        <div className="mt-2.5 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
          <span className="text-red-700 text-sm dark:text-red-300">
            {t('settings.tool.websearch.blacklist_tooltip')}
          </span>
        </div>
      )}
    </div>
  )
}

export default BlacklistSettings
