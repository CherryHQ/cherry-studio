import { Button, Input, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { ipcApi } from '@renderer/ipc'
import { useTranslation } from 'react-i18next'

function SettingRow({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-border border-b py-4 last:border-0">
      <div>
        <div className="font-medium text-sm">{title}</div>
        <div className="mt-1 text-muted-foreground text-xs">{description}</div>
      </div>
      <div className="w-56 shrink-0">{children}</div>
    </div>
  )
}

export function SettingsPage() {
  const { t } = useTranslation()
  const [reviewTime, setReviewTime] = usePreference('feature.english_learning.review_time')
  const [quietStart, setQuietStart] = usePreference('feature.english_learning.quiet_hours_start')
  const [quietEnd, setQuietEnd] = usePreference('feature.english_learning.quiet_hours_end')
  const [obsidianEnabled, setObsidianEnabled] = usePreference('feature.english_learning.obsidian.enabled')
  const [vaultPath, setVaultPath] = usePreference('feature.english_learning.obsidian.vault_path')
  const [folder, setFolder] = usePreference('feature.english_learning.obsidian.folder')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-bold text-2xl">{t('english_learning.settings.heading')}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t('english_learning.settings.description')}</p>
      </div>
      <section className="rounded-xl border border-border bg-card px-5">
        <SettingRow
          title={t('english_learning.settings.review_time')}
          description={t('english_learning.settings.review_time_description')}>
          <Input type="time" value={reviewTime} onChange={(event) => void setReviewTime(event.target.value)} />
        </SettingRow>
        <SettingRow
          title={t('english_learning.settings.quiet_hours')}
          description={t('english_learning.settings.quiet_hours_description')}>
          <div className="flex gap-2">
            <Input type="time" value={quietStart} onChange={(event) => void setQuietStart(event.target.value)} />
            <Input type="time" value={quietEnd} onChange={(event) => void setQuietEnd(event.target.value)} />
          </div>
        </SettingRow>
        <SettingRow
          title={t('english_learning.settings.snooze')}
          description={t('english_learning.settings.snooze_description')}>
          <Button variant="outline" onClick={() => void ipcApi.request('english_learning.reminder.snooze', {})}>
            {t('english_learning.settings.snooze_action')}
          </Button>
        </SettingRow>
      </section>
      <section className="rounded-xl border border-border bg-card px-5">
        <SettingRow
          title={t('english_learning.settings.obsidian')}
          description={t('english_learning.settings.obsidian_description')}>
          <div className="flex justify-end">
            <Switch checked={obsidianEnabled} onCheckedChange={(checked) => void setObsidianEnabled(checked)} />
          </div>
        </SettingRow>
        <SettingRow
          title={t('english_learning.settings.vault_path')}
          description={t('english_learning.settings.vault_path_description')}>
          <Input value={vaultPath} onChange={(event) => void setVaultPath(event.target.value)} />
        </SettingRow>
        <SettingRow
          title={t('english_learning.settings.folder')}
          description={t('english_learning.settings.folder_description')}>
          <Input value={folder} onChange={(event) => void setFolder(event.target.value)} />
        </SettingRow>
      </section>
    </div>
  )
}
