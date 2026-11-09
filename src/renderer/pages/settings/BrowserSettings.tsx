import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Dialog,
  DialogTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch
} from '@cherrystudio/ui'
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
import { cacheService } from '@renderer/data/CacheService'
import type { BrowserStartPageMode } from '@shared/data/preference/preferenceTypes'

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
  const [openChatLinks, setOpenChatLinks] = usePreference('app.browser.open_chat_links_in_right_panel')
  const [savingChatLinks, setSavingChatLinks] = useState(false)
  const [chatLinksError, setChatLinksError] = useState(false)
  const [autoOpenPanel, setAutoOpenPanel] = usePreference('app.browser.auto_open_panel')
  const [enabled, setEnabled] = usePreference('app.browser.agent_control.enabled')
  const [startPageMode, setStartPageMode] = usePreference('app.browser.start_page.mode')
  const [customUrl, setCustomUrl] = usePreference('app.browser.start_page.custom_url', { optimistic: false })
  const [customUrlDraft, setCustomUrlDraft] = useState(typeof customUrl === 'string' ? customUrl : '')
  const customUrlSaving = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const [dialog, setDialog] = useState<'import' | 'history' | 'clear' | null>(null)

  useEffect(() => {
    setCustomUrlDraft(typeof customUrl === 'string' ? customUrl : '')
  }, [customUrl])

  const saveCustomUrl = async () => {
    const value = customUrlDraft.trim()
    if (customUrlSaving.current || value === customUrl) return
    customUrlSaving.current = true
    setSaving(true)
    setError(false)
    try {
      await setCustomUrl(value)
    } catch {
      setError(true)
    } finally {
      customUrlSaving.current = false
      setSaving(false)
    }
  }

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
        <SettingRow id="setting-browser-auto-open-panel" className="scroll-mt-6 flex-nowrap">
          <div className="min-w-0">
            <SettingRowTitle id="browser-auto-open-panel-title">{t('settings.browser.autoOpenPanel')}</SettingRowTitle>
            <SettingDescription id="browser-auto-open-panel-help">
              {t('settings.browser.autoOpenPanelHelp')}
            </SettingDescription>
          </div>
          <Switch
            id="browser-auto-open-panel"
            aria-labelledby="browser-auto-open-panel-title"
            aria-describedby="browser-auto-open-panel-help"
            className="mt-0.5"
            checked={autoOpenPanel}
            disabled={saving}
            onCheckedChange={async (value) => {
              setSaving(true)
              setError(false)
              try {
                await setAutoOpenPanel(value)
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
        <SettingDivider />
        <SettingRow id="setting-browser-start-page" className="scroll-mt-6 flex-wrap gap-3">
          <div className="min-w-0 flex-1">
            <SettingRowTitle>{t('settings.browser.startPage')}</SettingRowTitle>
            <SettingDescription>{t('settings.browser.startPageHelp')}</SettingDescription>
          </div>
          <Select
            value={startPageMode === 'last' || startPageMode === 'custom' ? startPageMode : 'blank'}
            disabled={saving}
            onValueChange={async (value) => {
              setSaving(true)
              setError(false)
              try {
                await setStartPageMode(value as BrowserStartPageMode)
                if (startPageMode === 'last' && value !== 'last') {
                  cacheService.setPersist('ui.browser.last_urls', {})
                }
              } catch {
                setError(true)
              } finally {
                setSaving(false)
              }
            }}>
            <SelectTrigger aria-label={t('settings.browser.startPage')} className="w-60 max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="blank">{t('settings.browser.startPageBlank')}</SelectItem>
              <SelectItem value="last">{t('settings.browser.startPageLast')}</SelectItem>
              <SelectItem value="custom">{t('settings.browser.startPageCustom')}</SelectItem>
            </SelectContent>
          </Select>
          {startPageMode === 'custom' && (
            <div className="w-full">
              <Input
                aria-label={t('settings.browser.startPageCustomUrl')}
                aria-describedby="browser-start-page-custom-help"
                value={customUrlDraft}
                disabled={saving}
                onChange={(event) => setCustomUrlDraft(event.target.value)}
                onBlur={() => void saveCustomUrl()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void saveCustomUrl()
                  }
                }}
              />
              <SettingDescription id="browser-start-page-custom-help">
                {t('settings.browser.startPageCustomUrlHelp')}
              </SettingDescription>
            </div>
          )}
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-browser-open-chat-links" className="scroll-mt-6 flex-nowrap">
          <div className="min-w-0">
            <SettingRowTitle id="browser-open-chat-links-title">{t('settings.browser.openChatLinks')}</SettingRowTitle>
            <SettingDescription id="browser-open-chat-links-help">
              {t('settings.browser.openChatLinksHelp')}
            </SettingDescription>
          </div>
          <Switch
            id="browser-open-chat-links"
            aria-labelledby="browser-open-chat-links-title"
            aria-describedby="browser-open-chat-links-help"
            className="mt-0.5"
            checked={openChatLinks}
            disabled={savingChatLinks}
            onCheckedChange={async (value) => {
              setSavingChatLinks(true)
              setChatLinksError(false)
              try {
                await setOpenChatLinks(value)
              } catch {
                setChatLinksError(true)
              } finally {
                setSavingChatLinks(false)
              }
            }}
          />
        </SettingRow>
        {chatLinksError && (
          <p role="alert" className="mt-2 text-error text-sm">
            {t('settings.browser.error')}
          </p>
        )}
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
