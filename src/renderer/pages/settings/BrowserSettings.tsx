import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogTrigger, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { BrowserImportDialog } from '@renderer/components/BrowserImportDialog'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'

import { BrowserClearDialog } from './BrowserSettings/BrowserClearDialog'
import { BrowserHistoryDialog } from './BrowserSettings/BrowserHistoryDialog'

const sections = [
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
  const [dialog, setDialog] = useState<'import' | 'history' | 'clear' | null>(null)

  return (
    <SettingsContentColumn>
      <SettingGroup>
        <SettingTitle>{t('settings.browser.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow id="setting-browser-agent-control" className="scroll-mt-6 flex-nowrap">
          <div className="min-w-0">
            <SettingRowTitle id="browser-control-title">{t('settings.browser.control')}</SettingRowTitle>
            <SettingDescription id="browser-control-help">{t('settings.browser.controlHelp')}</SettingDescription>
          </div>
          <Switch
            id="browser-agent-control"
            aria-labelledby="browser-control-title"
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
        <SettingDivider />
        <SettingRow id="setting-browser-open-links" className="scroll-mt-6 flex-nowrap">
          <div className="min-w-0">
            <SettingRowTitle id="browser-open-links-title">{t('settings.browser.openLinks')}</SettingRowTitle>
            <SettingDescription id="browser-open-links-help">{t('settings.browser.openLinksHelp')}</SettingDescription>
          </div>
          <Switch
            id="browser-open-links"
            aria-labelledby="browser-open-links-title"
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
      <SettingGroup>
        {sections.map(({ kind, title, help, action }) => (
          <Dialog key={kind} open={dialog === kind} onOpenChange={(open) => setDialog(open ? kind : null)}>
            {kind !== 'import' && <SettingDivider />}
            <SettingRow id={`setting-browser-${kind}`} className="scroll-mt-6 flex-nowrap">
              <div className="min-w-0 flex-1">
                <SettingRowTitle id={`browser-${kind}-title`}>{t(title)}</SettingRowTitle>
                <SettingDescription>{t(help)}</SettingDescription>
              </div>
              <DialogTrigger asChild>
                <Button variant="outline" aria-labelledby={`browser-${kind}-action browser-${kind}-title`}>
                  <span id={`browser-${kind}-action`}>{t(action)}</span>
                </Button>
              </DialogTrigger>
            </SettingRow>
            {kind === 'import' ? (
              <BrowserImportDialog onDone={() => setDialog(null)} />
            ) : kind === 'history' ? (
              <BrowserHistoryDialog onOpenPage={() => setDialog(null)} />
            ) : (
              <BrowserClearDialog onDone={() => setDialog(null)} />
            )}
          </Dialog>
        ))}
      </SettingGroup>
    </SettingsContentColumn>
  )
}
