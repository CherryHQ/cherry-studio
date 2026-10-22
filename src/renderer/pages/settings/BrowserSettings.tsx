import { useCallback, useEffect, useState } from 'react'
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
import { ipcApi } from '@renderer/ipc'
import type { CustomAdblockRuleView } from '@shared/ipc/schemas/browser'

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
  const [adblock, setAdblock] = usePreference('app.browser.adblock.enabled')
  const [searchAds, setSearchAds] = usePreference('app.browser.adblock.search_ads')
  const [aiRules, setAiRules] = usePreference('app.browser.adblock.ai_rules')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const [dialog, setDialog] = useState<'import' | 'history' | 'clear' | null>(null)
  const [rules, setRules] = useState<CustomAdblockRuleView[]>([])

  const refreshRules = useCallback(async () => {
    try {
      const list = await ipcApi.request('adblock.list_rules')
      setRules(Array.isArray(list) ? list : [])
    } catch {
      setRules([])
    }
  }, [])

  useEffect(() => {
    void refreshRules()
  }, [refreshRules])

  const removeRule = async (id: string) => {
    setSaving(true)
    setError(false)
    try {
      await ipcApi.request('adblock.remove_rule', { id })
      await refreshRules()
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  const toggleRule = async (id: string, enabled: boolean) => {
    setSaving(true)
    setError(false)
    try {
      await ipcApi.request('adblock.set_rule_enabled', { id, enabled })
      await refreshRules()
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  const savePreference = async (write: (value: boolean) => Promise<void>, value: boolean) => {
    setSaving(true)
    setError(false)
    try {
      await write(value)
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsContentColumn>
      <SettingGroup>
        <SettingTitle>{t('settings.browser.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow id="setting-browser-adblock" className="scroll-mt-6 flex-nowrap">
          <div className="min-w-0">
            <SettingRowTitle id="browser-adblock-title">{t('settings.browser.adblock')}</SettingRowTitle>
            <SettingDescription id="browser-adblock-help">{t('settings.browser.adblockHelp')}</SettingDescription>
          </div>
          <Switch
            id="browser-adblock"
            aria-labelledby="browser-adblock-title"
            aria-describedby="browser-adblock-help"
            className="mt-0.5"
            checked={adblock}
            disabled={saving}
            onCheckedChange={(value) => savePreference(setAdblock, value)}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-browser-search-ads" className="scroll-mt-6 flex-nowrap">
          <div className="min-w-0">
            <SettingRowTitle id="browser-search-ads-title">{t('settings.browser.searchAds')}</SettingRowTitle>
            <SettingDescription id="browser-search-ads-help">{t('settings.browser.searchAdsHelp')}</SettingDescription>
          </div>
          <Switch
            id="browser-search-ads"
            aria-labelledby="browser-search-ads-title"
            aria-describedby="browser-search-ads-help"
            className="mt-0.5"
            checked={searchAds}
            disabled={saving}
            onCheckedChange={(value) => savePreference(setSearchAds, value)}
          />
        </SettingRow>
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
        <SettingTitle>{t('settings.browser.aiRules')}</SettingTitle>
        <SettingDivider />
        <SettingRow id="setting-browser-ai-rules" className="scroll-mt-6 flex-nowrap">
          <div className="min-w-0">
            <SettingRowTitle id="browser-ai-rules-title">{t('settings.browser.aiRulesEnabled')}</SettingRowTitle>
            <SettingDescription id="browser-ai-rules-help">
              {t('settings.browser.aiRulesEnabledHelp')}
            </SettingDescription>
          </div>
          <Switch
            id="browser-ai-rules"
            aria-labelledby="browser-ai-rules-title"
            aria-describedby="browser-ai-rules-help"
            className="mt-0.5"
            checked={aiRules}
            disabled={saving}
            onCheckedChange={(value) => savePreference(setAiRules, value)}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow className="flex-nowrap">
          <SettingDescription>{t('settings.browser.aiRulesHelp')}</SettingDescription>
        </SettingRow>
        {rules.length === 0 ? (
          <SettingRow>
            <SettingDescription>{t('settings.browser.aiRulesEmpty')}</SettingDescription>
          </SettingRow>
        ) : (
          rules.map((rule) => (
            <div key={rule.id}>
              <SettingDivider />
              <SettingRow id={`browser-adblock-rule-${rule.id}`} className="flex-nowrap">
                <div className="min-w-0 flex-1">
                  <SettingRowTitle>
                    {rule.domain}
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-normal text-xs">
                      {t(
                        rule.kind === 'cosmetic'
                          ? 'settings.browser.aiRulesCosmetic'
                          : 'settings.browser.aiRulesNetwork'
                      )}
                    </span>
                  </SettingRowTitle>
                  <SettingDescription>
                    <code className="break-all">{rule.value}</code>
                    {rule.note ? ` · ${rule.note}` : ''}
                  </SettingDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    aria-label={rule.domain}
                    checked={rule.enabled}
                    disabled={saving}
                    onCheckedChange={(value) => toggleRule(rule.id, value)}
                  />
                  <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => removeRule(rule.id)}>
                    {t('settings.browser.aiRulesDelete')}
                  </Button>
                </div>
              </SettingRow>
            </div>
          ))
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
