import type { CreateTaskRequest, TaskContextMode, TaskScheduleType, UpdateTaskRequest } from '@renderer/types'
import { Input, Modal, Radio, Select } from 'antd'
import { type FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type TaskFormData = {
  name: string
  prompt: string
  schedule_type: TaskScheduleType
  schedule_value: string
  context_mode: TaskContextMode
}

type TaskFormModalProps = {
  open: boolean
  initialData?: Partial<TaskFormData>
  onSave: (data: CreateTaskRequest | UpdateTaskRequest) => Promise<void>
  onCancel: () => void
  isEdit?: boolean
}

const { TextArea } = Input

const TaskFormModal: FC<TaskFormModalProps> = ({ open, initialData, onSave, onCancel, isEdit = false }) => {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<TaskFormData>({
    name: '',
    prompt: '',
    schedule_type: 'interval',
    schedule_value: '',
    context_mode: 'session'
  })

  useEffect(() => {
    if (open && initialData) {
      setForm({
        name: initialData.name ?? '',
        prompt: initialData.prompt ?? '',
        schedule_type: initialData.schedule_type ?? 'interval',
        schedule_value: initialData.schedule_value ?? '',
        context_mode: initialData.context_mode ?? 'session'
      })
    } else if (open) {
      setForm({
        name: '',
        prompt: '',
        schedule_type: 'interval',
        schedule_value: '',
        context_mode: 'session'
      })
    }
  }, [open, initialData])

  const handleSave = async () => {
    setLoading(true)
    try {
      await onSave(form)
    } finally {
      setLoading(false)
    }
  }

  const isValid = form.name.trim() && form.prompt.trim() && form.schedule_value.trim()

  const renderScheduleInput = () => {
    switch (form.schedule_type) {
      case 'cron':
        return (
          <Input
            value={form.schedule_value}
            onChange={(e) => setForm((f) => ({ ...f, schedule_value: e.target.value }))}
            placeholder={t('agent.cherryClaw.tasks.cronPlaceholder')}
          />
        )
      case 'interval':
        return (
          <Input
            type="number"
            min={1}
            value={form.schedule_value}
            onChange={(e) => setForm((f) => ({ ...f, schedule_value: e.target.value }))}
            placeholder={t('agent.cherryClaw.tasks.intervalPlaceholder')}
            suffix="min"
          />
        )
      case 'once':
        return (
          <Input
            type="datetime-local"
            value={form.schedule_value}
            onChange={(e) => setForm((f) => ({ ...f, schedule_value: new Date(e.target.value).toISOString() }))}
          />
        )
      default:
        return null
    }
  }

  return (
    <Modal
      open={open}
      title={isEdit ? t('agent.cherryClaw.tasks.edit') : t('agent.cherryClaw.tasks.add')}
      onOk={handleSave}
      onCancel={onCancel}
      okText={t('agent.cherryClaw.tasks.save')}
      cancelText={t('agent.cherryClaw.tasks.cancel')}
      confirmLoading={loading}
      okButtonProps={{ disabled: !isValid }}
      destroyOnClose>
      <div className="flex flex-col gap-4 py-2">
        <div>
          <label className="mb-1 block font-medium text-sm">{t('agent.cherryClaw.tasks.name.label')}</label>
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder={t('agent.cherryClaw.tasks.name.placeholder')}
          />
        </div>

        <div>
          <label className="mb-1 block font-medium text-sm">{t('agent.cherryClaw.tasks.prompt.label')}</label>
          <TextArea
            value={form.prompt}
            onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
            placeholder={t('agent.cherryClaw.tasks.prompt.placeholder')}
            rows={4}
          />
        </div>

        <div>
          <label className="mb-1 block font-medium text-sm">{t('agent.cherryClaw.tasks.scheduleType.label')}</label>
          <Select
            value={form.schedule_type}
            onChange={(value) => setForm((f) => ({ ...f, schedule_type: value, schedule_value: '' }))}
            className="w-full"
            options={[
              { value: 'cron', label: t('agent.cherryClaw.tasks.scheduleType.cron') },
              { value: 'interval', label: t('agent.cherryClaw.tasks.scheduleType.interval') },
              { value: 'once', label: t('agent.cherryClaw.tasks.scheduleType.once') }
            ]}
          />
        </div>

        <div>
          <label className="mb-1 block font-medium text-sm">{t('agent.cherryClaw.tasks.scheduleValue')}</label>
          {renderScheduleInput()}
        </div>

        <div>
          <label className="mb-1 block font-medium text-sm">{t('agent.cherryClaw.tasks.contextMode.label')}</label>
          <Radio.Group
            value={form.context_mode}
            onChange={(e) => setForm((f) => ({ ...f, context_mode: e.target.value }))}>
            <Radio value="session">
              <span className="text-sm">{t('agent.cherryClaw.tasks.contextMode.session')}</span>
              <span className="ml-1 text-gray-400 text-xs">{t('agent.cherryClaw.tasks.contextMode.sessionDesc')}</span>
            </Radio>
            <Radio value="isolated">
              <span className="text-sm">{t('agent.cherryClaw.tasks.contextMode.isolated')}</span>
              <span className="ml-1 text-gray-400 text-xs">{t('agent.cherryClaw.tasks.contextMode.isolatedDesc')}</span>
            </Radio>
          </Radio.Group>
        </div>
      </div>
    </Modal>
  )
}

export default TaskFormModal
