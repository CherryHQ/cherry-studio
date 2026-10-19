import { Download, FolderOpen, Pause, Play, RotateCcw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input, InputNumber, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
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
import { formatFileSize } from '@renderer/utils/file'
import type { DownloadTaskSummary } from '@shared/ipc/schemas/downloads'

const POLL_INTERVAL_MS = 1000

const STATE_LABEL_KEYS = {
  queued: 'settings.downloads.state.queued',
  probing: 'settings.downloads.state.probing',
  downloading: 'settings.downloads.state.downloading',
  paused: 'settings.downloads.state.paused',
  merging: 'settings.downloads.state.merging',
  completed: 'settings.downloads.state.completed',
  failed: 'settings.downloads.state.failed',
  cancelled: 'settings.downloads.state.cancelled'
} as const

const ACTIVE_STATES = new Set(['queued', 'probing', 'downloading'])
const RESTARTABLE_STATES = new Set(['paused', 'failed'])

export function DownloadsSettings() {
  const { t } = useTranslation()
  const [dir, setDir] = usePreference('app.browser.downloads.dir')
  const [draftDir, setDraftDir] = useState(dir)
  useEffect(() => setDraftDir(dir), [dir])
  const [ask, setAsk] = usePreference('app.browser.downloads.ask_where_to_save')
  const [maxTasks, setMaxTasks] = usePreference('app.browser.downloads.max_concurrent_tasks')
  const [connections, setConnections] = usePreference('app.browser.downloads.connections_per_task')
  const [autoResume, setAutoResume] = usePreference('app.browser.downloads.auto_resume')
  const [tasks, setTasks] = useState<DownloadTaskSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setTasks(await ipcApi.request('downloads.list', {}))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const act = async (
    route:
      | 'downloads.pause'
      | 'downloads.resume'
      | 'downloads.cancel'
      | 'downloads.retry'
      | 'downloads.remove'
      | 'downloads.open_file'
      | 'downloads.open_folder',
    id: string
  ) => {
    try {
      await ipcApi.request(route, { id })
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const pickDirectory = async () => {
    try {
      const picked = await ipcApi.request('downloads.pick_directory', {})
      if (picked) await setDir(picked)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <SettingsContentColumn>
      <SettingGroup>
        <SettingTitle>{t('settings.downloads.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow className="flex-nowrap">
          <div className="min-w-0">
            <SettingRowTitle>{t('settings.downloads.location')}</SettingRowTitle>
            <SettingDescription>{t('settings.downloads.locationHelp')}</SettingDescription>
          </div>
          <div className="flex items-center gap-2">
            <Input
              className="w-64"
              value={draftDir}
              placeholder={t('settings.downloads.locationPlaceholder')}
              onChange={(event) => setDraftDir(event.target.value)}
              onBlur={() => void setDir(draftDir)}
            />
            <Button variant="outline" onClick={() => void pickDirectory()}>
              {t('settings.downloads.browse')}
            </Button>
          </div>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <div className="min-w-0">
            <SettingRowTitle>{t('settings.downloads.ask')}</SettingRowTitle>
            <SettingDescription>{t('settings.downloads.askHelp')}</SettingDescription>
          </div>
          <Switch checked={ask} onCheckedChange={(value) => void setAsk(value)} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <div className="min-w-0">
            <SettingRowTitle>{t('settings.downloads.autoResume')}</SettingRowTitle>
            <SettingDescription>{t('settings.downloads.autoResumeHelp')}</SettingDescription>
          </div>
          <Switch checked={autoResume} onCheckedChange={(value) => void setAutoResume(value)} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <div className="min-w-0">
            <SettingRowTitle>{t('settings.downloads.maxTasks')}</SettingRowTitle>
            <SettingDescription>{t('settings.downloads.maxTasksHelp')}</SettingDescription>
          </div>
          <InputNumber
            className="w-24"
            min={1}
            max={10}
            value={maxTasks}
            onBlur={(value) => void setMaxTasks(value ?? 3)}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <div className="min-w-0">
            <SettingRowTitle>{t('settings.downloads.connections')}</SettingRowTitle>
            <SettingDescription>{t('settings.downloads.connectionsHelp')}</SettingDescription>
          </div>
          <InputNumber
            className="w-24"
            min={1}
            max={16}
            value={connections}
            onBlur={(value) => void setConnections(value ?? 8)}
          />
        </SettingRow>
        {error && (
          <p role="alert" className="mt-2 text-error text-sm">
            {error}
          </p>
        )}
      </SettingGroup>

      <SettingGroup>
        <SettingTitle>{t('settings.downloads.list')}</SettingTitle>
        <SettingDivider />
        {tasks.length === 0 ? (
          <SettingDescription className="py-4">{t('settings.downloads.empty')}</SettingDescription>
        ) : (
          tasks.map((task, index) => (
            <div key={task.id}>
              {index > 0 && <SettingDivider />}
              <SettingRow className="items-start gap-4">
                <div className="min-w-0 flex-1">
                  <SettingRowTitle className="truncate">{task.fileName}</SettingRowTitle>
                  <SettingDescription className="mt-1">
                    {t('settings.downloads.progress', {
                      received: formatFileSize(task.receivedBytes),
                      total: task.totalBytes > 0 ? formatFileSize(task.totalBytes) : '—'
                    })}
                    {' · '}
                    {t(STATE_LABEL_KEYS[task.state])}
                    {task.error ? ` · ${task.error}` : ''}
                  </SettingDescription>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-accent">
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{
                        width:
                          task.totalBytes > 0
                            ? `${Math.min(100, (task.receivedBytes / task.totalBytes) * 100)}%`
                            : task.state === 'completed'
                              ? '100%'
                              : '0%'
                      }}
                    />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {ACTIVE_STATES.has(task.state) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t('settings.downloads.pause')}
                      onClick={() => void act('downloads.pause', task.id)}>
                      <Pause className="size-4" />
                    </Button>
                  )}
                  {RESTARTABLE_STATES.has(task.state) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t(task.state === 'failed' ? 'settings.downloads.retry' : 'settings.downloads.resume')}
                      onClick={() =>
                        void act(task.state === 'failed' ? 'downloads.retry' : 'downloads.resume', task.id)
                      }>
                      {task.state === 'failed' ? <RotateCcw className="size-4" /> : <Play className="size-4" />}
                    </Button>
                  )}
                  {task.state === 'completed' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t('settings.downloads.openFile')}
                      onClick={() => void act('downloads.open_file', task.id)}>
                      <Download className="size-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t('settings.downloads.openFolder')}
                    onClick={() => void act('downloads.open_folder', task.id)}>
                    <FolderOpen className="size-4" />
                  </Button>
                  {!ACTIVE_STATES.has(task.state) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t('settings.downloads.remove')}
                      onClick={() => void act('downloads.remove', task.id)}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                  {ACTIVE_STATES.has(task.state) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t('settings.downloads.cancel')}
                      onClick={() => void act('downloads.cancel', task.id)}>
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              </SettingRow>
            </div>
          ))
        )}
      </SettingGroup>
    </SettingsContentColumn>
  )
}
