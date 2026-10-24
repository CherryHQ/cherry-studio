import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'

export function FeishuApplicationPicker({
  value,
  onChange
}: {
  value: string | null
  onChange: (id: string | null) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const { data, error, isLoading, mutate } = useSWR('credential.feishu.applications', () =>
    ipcApi.request('credential.list', { connector: 'feishu', kind: 'application' })
  )
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [domain, setDomain] = useState<'feishu' | 'lark'>('feishu')
  const [fields, setFields] = useState({ appId: '', appSecret: '', encryptKey: '', verificationToken: '' })
  const applications = data?.filter((entry) => entry.status === 'available' && entry.kind === 'application') ?? []

  async function save() {
    setSaving(true)
    setFailed(false)
    try {
      const app = await ipcApi.request('credential.feishu.create_application', {
        label: fields.appId.trim(),
        domain,
        appId: fields.appId.trim(),
        appSecret: fields.appSecret.trim(),
        ...(fields.encryptKey.trim() && { encryptKey: fields.encryptKey.trim() }),
        ...(fields.verificationToken.trim() && { verificationToken: fields.verificationToken.trim() })
      })
      await mutate()
      onChange(app.id)
      setAdding(false)
      setFields({ appId: '', appSecret: '', encryptKey: '', verificationToken: '' })
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Label htmlFor={id}>{t('agent.channels.feishu.appId')}</Label>
      <div className="flex items-center gap-2">
        <Select
          value={value ?? '__none'}
          onValueChange={(next) => onChange(next === '__none' ? null : next)}
          disabled={isLoading || saving}>
          <SelectTrigger id={id} className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">{t('common.none')}</SelectItem>
            {applications.map((app) => (
              <SelectItem key={app.id} value={app.id}>
                {app.label} · {app.appId}
              </SelectItem>
            ))}
            {value && !applications.some((app) => app.id === value) && (
              <SelectItem value={value} disabled>
                {t('common.error')}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          onClick={() => {
            setAdding(!adding)
            setFields({ appId: '', appSecret: '', encryptKey: '', verificationToken: '' })
            setFailed(false)
          }}
          disabled={saving}>
          {t('common.add')}
        </Button>
      </div>
      {error && (
        <div role="alert" className="text-sm text-destructive">
          {t('common.error')}
          <Button variant="link" onClick={() => void mutate()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {adding && (
        <div className="flex flex-col gap-3">
          <Label htmlFor={`${id}-domain`}>{t('agent.channels.feishu.domain')}</Label>
          <Select value={domain} onValueChange={(next) => setDomain(next as 'feishu' | 'lark')} disabled={saving}>
            <SelectTrigger id={`${id}-domain`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="feishu">{t('agent.channels.feishu.domainFeishu')}</SelectItem>
              <SelectItem value="lark">{t('agent.channels.feishu.domainLark')}</SelectItem>
            </SelectContent>
          </Select>
          {(['appId', 'appSecret', 'encryptKey', 'verificationToken'] as const).map((key) => (
            <div key={key} className="flex flex-col gap-1">
              <Label htmlFor={`${id}-${key}`}>
                {t(
                  {
                    appId: 'agent.channels.feishu.appId',
                    appSecret: 'agent.channels.feishu.appSecret',
                    encryptKey: 'agent.channels.feishu.encryptKey',
                    verificationToken: 'agent.channels.feishu.verificationToken'
                  }[key]
                )}
              </Label>
              <Input
                id={`${id}-${key}`}
                type={key === 'appId' ? 'text' : 'password'}
                value={fields[key]}
                disabled={saving}
                onChange={(event) => setFields({ ...fields, [key]: event.target.value })}
                autoComplete="off"
              />
            </div>
          ))}
          {failed && (
            <p role="alert" className="text-sm text-destructive">
              {t('common.save_failed')}
            </p>
          )}
          <Button onClick={() => void save()} disabled={saving || !fields.appId.trim() || !fields.appSecret.trim()}>
            {t('common.save')}
          </Button>
        </div>
      )}
    </div>
  )
}
