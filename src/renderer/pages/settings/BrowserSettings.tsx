import { Button, Dialog, DialogTrigger, Label, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { SettingGroup, SettingRow, SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BrowserClearDialog } from './BrowserSettings/BrowserClearDialog'
import { BrowserHistoryDialog } from './BrowserSettings/BrowserHistoryDialog'
import { BrowserImportDialog } from './BrowserSettings/BrowserImportDialog'
import { BrowserToolPermissionsDialog } from './BrowserSettings/BrowserToolPermissionsDialog'

const sections = [
  {
    kind: 'permissions',
    title: 'settings.browser.permissions',
    help: 'settings.browser.permissionsHelp',
    action: 'settings.browser.manage'
  },
  {
    kind: 'import',
    title: 'settings.browser.import',
    help: 'settings.browser.importHelp',
    action: 'settings.browser.importAction'
  },
  {
    kind: 'history',
    title: 'settings.browser.history',
    help: 'settings.browser.historyHelp',
    action: 'settings.browser.manage'
  },
  { kind: 'clear', title: 'settings.browser.clear', help: 'settings.browser.clearHelp', action: 'common.clear' }
] as const

export function BrowserSettings() {
  const { t } = useTranslation()
  const [openLinks, setOpenLinks] = usePreference('app.browser.open_links_in_browser')
  const [enabled, setEnabled] = usePreference('app.browser.agent_control.enabled')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const [dialog, setDialog] = useState<'import' | 'history' | 'clear' | 'permissions' | null>(null)

  return (
    <SettingsContentColumn>
      <h1 className="mb-6 font-semibold text-lg">{t('settings.browser.title')}</h1>
      <SettingGroup variant="plain" className="pb-6">
        <SettingRow className="flex-nowrap items-start">
          <div className="min-w-0 space-y-2">
            <Label htmlFor="browser-agent-control">{t('settings.browser.control')}</Label>
            <p id="browser-control-help" className="max-w-xl text-muted-foreground text-sm leading-relaxed">
              {t('settings.browser.controlHelp')}
            </p>
          </div>
          <Switch
            id="browser-agent-control"
            aria-describedby="browser-control-help"
            className="mt-0.5"
            checked={enabled}
            disabled={saving}
            onCheckedChange={async (value) => {
              setSaving(true)
              setError(false)
              try {
                await setEnabled(value)
              } catch {
                setError(true)
              } finally {
                setSaving(false)
              }
            }}
          />
        </SettingRow>
        <SettingRow className="mt-5 flex-nowrap items-start">
          <div className="min-w-0 space-y-2">
            <Label htmlFor="browser-open-links">{t('settings.browser.openLinks')}</Label>
            <p id="browser-open-links-help" className="max-w-xl text-muted-foreground text-sm leading-relaxed">
              {t('settings.browser.openLinksHelp')}
            </p>
          </div>
          <Switch
            id="browser-open-links"
            aria-describedby="browser-open-links-help"
            className="mt-0.5"
            checked={openLinks}
            disabled={saving}
            onCheckedChange={async (value) => {
              setSaving(true)
              setError(false)
              try {
                await setOpenLinks(value)
              } catch {
                setError(true)
              } finally {
                setSaving(false)
              }
            }}
          />
        </SettingRow>
        {error && (
          <p role="alert" className="mt-2 text-error text-sm">
            {t('settings.browser.error')}
          </p>
        )}
      </SettingGroup>
      <SettingGroup variant="plain">
        {sections.map(({ kind, title, help, action }) => (
          <Dialog key={kind} open={dialog === kind} onOpenChange={(open) => setDialog(open ? kind : null)}>
            <SettingRow className="py-4">
              <div className="min-w-0 flex-1 space-y-1">
                <h2 id={`browser-${kind}-title`} className="font-medium text-sm">
                  {t(title)}
                </h2>
                <p className="text-muted-foreground text-sm">{t(help)}</p>
              </div>
              <DialogTrigger asChild>
                <Button variant="outline" aria-labelledby={`browser-${kind}-action browser-${kind}-title`}>
                  <span id={`browser-${kind}-action`}>{t(action)}</span>
                </Button>
              </DialogTrigger>
            </SettingRow>
            {dialog === kind &&
              (kind === 'permissions' ? (
                <BrowserToolPermissionsDialog />
              ) : kind === 'import' ? (
                <BrowserImportDialog onDone={() => setDialog(null)} />
              ) : kind === 'history' ? (
                <BrowserHistoryDialog onOpenPage={() => setDialog(null)} />
              ) : (
                <BrowserClearDialog onDone={() => setDialog(null)} />
              ))}
          </Dialog>
        ))}
      </SettingGroup>
    </SettingsContentColumn>
  )
}
