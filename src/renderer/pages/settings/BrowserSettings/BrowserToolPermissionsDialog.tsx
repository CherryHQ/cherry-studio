import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { BROWSER_TOOLS } from '@shared/ai/browserTools'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function BrowserToolPermissionsDialog() {
  const { t } = useTranslation()
  const [permissions, setPermissions] = usePreference('app.browser.tool_permissions')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  return (
    <DialogContent className="flex max-h-[80vh] flex-col overflow-hidden sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{t('settings.browser.permissions')}</DialogTitle>
        <DialogDescription>{t('settings.browser.permissionsHelp')}</DialogDescription>
      </DialogHeader>
      {error && (
        <p role="alert" className="text-error text-sm">
          {t('settings.browser.error')}
        </p>
      )}
      <div className="min-h-0 divide-y divide-border-subtle overflow-y-auto pr-1">
        {BROWSER_TOOLS.map(({ name, labelKey }) => (
          <div key={name} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <div id={`browser-tool-${name}`} className="text-sm">
                {t(labelKey)}
              </div>
              <div className="text-muted-foreground text-xs">{name}</div>
            </div>
            <Select
              value={permissions?.[name] ?? 'ask'}
              disabled={saving}
              onValueChange={async (value: 'ask' | 'allow' | 'deny') => {
                setSaving(true)
                setError(false)
                try {
                  await setPermissions({ ...permissions, [name]: value })
                } catch {
                  setError(true)
                } finally {
                  setSaving(false)
                }
              }}>
              <SelectTrigger aria-labelledby={`browser-tool-${name}`} className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['ask', 'allow', 'deny'] as const).map((permission) => (
                  <SelectItem key={permission} value={permission}>
                    {t(
                      {
                        ask: 'settings.browser.permission.ask',
                        allow: 'settings.browser.permission.allow',
                        deny: 'settings.browser.permission.deny'
                      }[permission]
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </DialogContent>
  )
}
