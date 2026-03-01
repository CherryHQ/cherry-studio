/**
 * Task Edit/Create Popup
 * Allows users to create or edit periodic tasks
 */

import { loggerService } from '@logger'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { getTaskById } from '@renderer/store/tasks'
import { createTask, updateTask as updateTaskThunk } from '@renderer/store/tasksThunk'
import type { Assistant } from '@renderer/types'
import type { CreateTaskForm, TaskSchedule, TaskTarget } from '@types'
import { Button, Form, Input, Modal, Select, Switch } from 'antd'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface TaskEditPopupProps {
  open: boolean
  mode: 'create' | 'edit'
  taskId?: string
  onClose: () => void
}

const logger = loggerService.withContext('TaskEditPopup')

const TaskEditPopup: FC<TaskEditPopupProps> = ({ open, mode, taskId, onClose }) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)

  const { assistants } = useAssistants()
  const { agents } = useAgents()

  const task = useAppSelector((state) => {
    if (mode === 'edit' && taskId) {
      return getTaskById(state)(taskId)
    }
    return null
  })

  useEffect(() => {
    if (open) {
      if (task && mode === 'edit') {
        form.setFieldsValue({
          name: task.name,
          description: task.description,
          emoji: task.emoji,
          scheduleType: 'manual',
          scheduleDescription: t('tasks.schedule.manual'),
          targets: task.targets.map((t) => `${t.type}:${t.id}`),
          message: task.execution.message,
          continueConversation: task.execution.continueConversation,
          maxExecutionTime: task.execution.maxExecutionTime,
          notifyOnComplete: task.execution.notifyOnComplete,
          enabled: false
        })
      } else {
        // Set default values for create mode
        form.setFieldsValue({
          scheduleType: 'manual',
          scheduleDescription: t('tasks.schedule.manual'),
          targets: [],
          continueConversation: false,
          maxExecutionTime: 300,
          notifyOnComplete: true,
          enabled: false
        })
      }
    }
  }, [task, mode, form, open])

  const handleFinish = async (values: any) => {
    setLoading(true)

    try {
      // Build targets array
      const targets: TaskTarget[] = (values.targets || []).map((target: string) => {
        const [type, id] = target.split(':')
        if (type === 'assistant') {
          const assistant = assistants.find((a) => a.id === id)
          return { type: 'assistant', id, name: assistant?.name || 'Unknown Assistant' }
        } else {
          const agent = agents.find((a) => a.id === id)
          return { type: 'agent', id, name: agent?.name || 'Unknown Agent' }
        }
      })

      const schedule: TaskSchedule = {
        type: 'manual',
        description: values.scheduleDescription || t('tasks.schedule.manual')
      }

      const taskData: CreateTaskForm = {
        name: values.name,
        description: values.description,
        emoji: values.emoji,
        targets:
          targets.length > 0
            ? targets
            : [{ type: 'assistant', id: assistants[0]?.id || 'default', name: assistants[0]?.name || '默认助手' }],
        schedule,
        enabled: false,
        execution: {
          message: values.message,
          continueConversation: values.continueConversation,
          maxExecutionTime: values.maxExecutionTime,
          notifyOnComplete: values.notifyOnComplete
        }
      }

      if (mode === 'create') {
        await dispatch(createTask(taskData) as any)
      } else if (task) {
        await dispatch(updateTaskThunk({ ...task, ...taskData }) as any)
      }

      setLoading(false)
      onClose()
    } catch (error) {
      logger.error('保存任务失败：', error as Error)
      setLoading(false)
    }
  }

  const targetOptions = [
    {
      label: t('tasks.form.assistants'),
      options: assistants.map((a: Assistant) => ({ label: a.name, value: `assistant:${a.id}` }))
    },
    {
      label: t('tasks.form.agents'),
      options: agents.map((a) => ({ label: a.name, value: `agent:${a.id}` }))
    }
  ]

  return (
    <Modal
      title={mode === 'create' ? t('tasks.create') : t('tasks.edit')}
      open={open}
      onCancel={onClose}
      width={600}
      footer={
        <Footer>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="primary" loading={loading} onClick={() => form.submit()}>
            {mode === 'create' ? t('common.create') : t('common.save')}
          </Button>
        </Footer>
      }>
      <Form
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        initialValues={{
          scheduleType: 'manual',
          scheduleDescription: t('tasks.schedule.manual'),
          targets: [],
          continueConversation: false,
          maxExecutionTime: 300,
          notifyOnComplete: true,
          enabled: false
        }}>
        <Form.Item
          label={t('tasks.form.name')}
          name="name"
          rules={[{ required: true, message: t('tasks.form.name_required') }]}>
          <Input placeholder={t('tasks.form.name_placeholder')} />
        </Form.Item>

        <Form.Item label={t('tasks.form.description')} name="description">
          <Input.TextArea placeholder={t('tasks.form.description_placeholder')} rows={2} />
        </Form.Item>

        <Form.Item label={t('tasks.form.emoji')} name="emoji">
          <Input placeholder="📝" />
        </Form.Item>

        <Section>
          <SectionTitle>{t('tasks.form.section_schedule')}</SectionTitle>

          <Form.Item label={t('tasks.form.schedule_type')} name="scheduleType">
            <Select
              disabled
              value="manual"
              onChange={() => {
                form.setFieldValue('scheduleDescription', t('tasks.schedule.manual'))
              }}>
              <Select.Option value="manual">{t('tasks.schedule_type.manual')}</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            label={t('tasks.form.schedule_description')}
            name="scheduleDescription"
            rules={[{ required: true }]}>
            <Input placeholder={t('tasks.form.schedule_description_placeholder')} />
          </Form.Item>
        </Section>

        <Section>
          <SectionTitle>{t('tasks.form.section_targets')}</SectionTitle>
          <Form.Item
            label={t('tasks.form.targets')}
            name="targets"
            rules={[{ required: true, message: t('tasks.form.targets_required') }]}>
            <Select
              mode="multiple"
              placeholder={t('tasks.form.targets_placeholder')}
              options={targetOptions}
              filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
        </Section>

        <Section>
          <SectionTitle>{t('tasks.form.section_execution')}</SectionTitle>

          <Form.Item
            label={t('tasks.form.message')}
            name="message"
            rules={[{ required: true, message: t('tasks.form.message_required') }]}>
            <Input.TextArea placeholder={t('tasks.form.message_placeholder')} rows={4} />
          </Form.Item>

          <Form.Item label={t('tasks.form.continue_conversation')} name="continueConversation" valuePropName="checked">
            <div>
              <Switch />
              <HelpText>{t('tasks.form.continue_conversation_help')}</HelpText>
            </div>
          </Form.Item>

          <Form.Item label={t('tasks.form.max_execution_time')} name="maxExecutionTime">
            <Input type="number" placeholder="300" />
          </Form.Item>

          <Form.Item label={t('tasks.form.notify_on_complete')} name="notifyOnComplete" valuePropName="checked">
            <div>
              <Switch />
              <HelpText>{t('tasks.form.notify_on_complete_help')}</HelpText>
            </div>
          </Form.Item>
        </Section>
      </Form>
    </Modal>
  )
}

const Section = styled.div`
  margin-bottom: 24px;
  padding: 16px;
  background: var(--color-background);
  border-radius: 8px;
`

const SectionTitle = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-1);
  margin-bottom: 12px;
`

const HelpText = styled.div`
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-text-2);
`

const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 12px;
`

export default TaskEditPopup
