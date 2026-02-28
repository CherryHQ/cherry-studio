/**
 * Task Edit/Create Popup
 * Allows users to create or edit periodic tasks
 */

import { useAppDispatch, useAppSelector } from '@renderer/store'
import { addTask, getTaskById, updateTask } from '@renderer/store/tasks'
import type { CreateTaskForm, TaskSchedule } from '@types'
import { Button, Form, Input, Modal, Select, Switch } from 'antd'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import styled from 'styled-components'

interface TaskEditPopupProps {
  mode: 'create' | 'edit'
  taskId?: string
}

const TaskEditPopupComponent: FC<TaskEditPopupProps> = ({ mode, taskId }) => {
  const dispatch = useAppDispatch()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)

  const task = useAppSelector((state) => {
    if (mode === 'edit' && taskId) {
      return getTaskById(state)(taskId)
    }
    return null
  })

  useEffect(() => {
    if (task && mode === 'edit') {
      form.setFieldsValue({
        name: task.name,
        description: task.description,
        emoji: task.emoji,
        scheduleType: task.schedule.type,
        cronExpression: task.schedule.cronExpression,
        intervalMinutes: task.schedule.interval ? Math.floor(task.schedule.interval / 60000) : undefined,
        scheduleDescription: task.schedule.description,
        message: task.execution.message,
        continueConversation: task.execution.continueConversation,
        maxExecutionTime: task.execution.maxExecutionTime,
        notifyOnComplete: task.execution.notifyOnComplete,
        enabled: task.enabled
      })
    } else {
      // Set default values for create mode
      form.setFieldsValue({
        scheduleType: 'cron',
        cronExpression: '0 9 * * *',
        intervalMinutes: 60,
        continueConversation: false,
        maxExecutionTime: 300,
        notifyOnComplete: true,
        enabled: true
      })
    }
  }, [task, mode, form])

  const handleFinish = async (values: any) => {
    setLoading(true)

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 500))

    const schedule: TaskSchedule = {
      type: values.scheduleType,
      description: values.scheduleDescription,
      ...(values.scheduleType === 'cron' ? { cronExpression: values.cronExpression } : {}),
      ...(values.scheduleType === 'interval' ? { interval: (values.intervalMinutes || 60) * 60000 } : {})
    }

    const taskData: CreateTaskForm = {
      name: values.name,
      description: values.description,
      emoji: values.emoji,
      targets: [
        {
          type: 'assistant',
          id: 'default',
          name: '默认助手'
        }
      ],
      schedule,
      enabled: values.enabled,
      execution: {
        message: values.message,
        continueConversation: values.continueConversation,
        maxExecutionTime: values.maxExecutionTime,
        notifyOnComplete: values.notifyOnComplete
      }
    }

    if (mode === 'create') {
      dispatch(addTask(taskData))
    } else if (task) {
      dispatch(
        updateTask({
          ...task,
          ...taskData
        })
      )
    }

    setLoading(false)
    TaskEditPopup.hide()
  }

  return (
    <Modal
      title={mode === 'create' ? '创建周期性任务' : '编辑任务'}
      open={true}
      onCancel={() => TaskEditPopup.hide()}
      footer={
        <Footer>
          <Button onClick={() => TaskEditPopup.hide()}>取消</Button>
          <Button type="primary" loading={loading} onClick={() => form.submit()}>
            {mode === 'create' ? '创建' : '保存'}
          </Button>
        </Footer>
      }>
      <Form
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        initialValues={{
          scheduleType: 'cron',
          cronExpression: '0 9 * * *',
          intervalMinutes: 60,
          continueConversation: false,
          maxExecutionTime: 300,
          notifyOnComplete: true,
          enabled: true
        }}>
        <Form.Item label="任务名称" name="name" rules={[{ required: true, message: '请输入任务名称' }]}>
          <Input placeholder="例如：每日日报" />
        </Form.Item>

        <Form.Item label="描述" name="description">
          <Input.TextArea placeholder="描述这个任务的作用..." rows={2} />
        </Form.Item>

        <Form.Item label="图标" name="emoji">
          <Input placeholder="📝" />
        </Form.Item>

        <Section>
          <SectionTitle>调度配置</SectionTitle>

          <Form.Item label="调度类型" name="scheduleType">
            <Select
              onChange={(value) => {
                // Update default cron when switching to cron
                if (value === 'cron') {
                  form.setFieldValue('cronExpression', '0 9 * * *')
                  form.setFieldValue('scheduleDescription', '每天 09:00')
                } else if (value === 'interval') {
                  form.setFieldValue('intervalMinutes', 60)
                  form.setFieldValue('scheduleDescription', '每小时执行')
                }
              }}>
              <Select.Option value="cron">Cron 表达式</Select.Option>
              <Select.Option value="interval">固定间隔</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => prevValues.scheduleType !== currentValues.scheduleType}>
            {({ getFieldValue }) =>
              getFieldValue('scheduleType') === 'cron' ? (
                <Form.Item
                  label="Cron 表达式"
                  name="cronExpression"
                  rules={[{ required: true, message: '请输入 Cron 表达式' }]}>
                  <Input placeholder="0 9 * * *" />
                </Form.Item>
              ) : (
                <Form.Item
                  label="间隔（分钟）"
                  name="intervalMinutes"
                  rules={[{ required: true, message: '请输入间隔时间' }]}>
                  <Input type="number" placeholder="60" />
                </Form.Item>
              )
            }
          </Form.Item>

          <Form.Item label="描述" name="scheduleDescription" rules={[{ required: true, message: '请输入调度描述' }]}>
            <Input placeholder="例如：每天 09:00" />
          </Form.Item>

          <CronHelp>
            <strong>Cron 表达式说明：</strong>
            <br />* * * * * (分 时 日 月 周)
            <br />0 9 * * * - 每天 9:00
            <br />0 */6 * * * - 每 6 小时
            <br />0 9 * * 1 - 每周一 9:00
          </CronHelp>
        </Section>

        <Section>
          <SectionTitle>执行配置</SectionTitle>

          <Form.Item label="执行消息" name="message" rules={[{ required: true, message: '请输入执行消息' }]}>
            <Input.TextArea placeholder="发送给智能体/助手的消息..." rows={4} />
          </Form.Item>

          <Form.Item label="继续对话" name="continueConversation" valuePropName="checked">
            <Switch />
            <HelpText>继续上次执行的对话上下文</HelpText>
          </Form.Item>

          <Form.Item label="超时时间（秒）" name="maxExecutionTime">
            <Input type="number" placeholder="300" />
          </Form.Item>

          <Form.Item label="完成通知" name="notifyOnComplete" valuePropName="checked">
            <Switch />
            <HelpText>任务完成时发送通知</HelpText>
          </Form.Item>
        </Section>

        <Form.Item label="启用任务" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
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

const CronHelp = styled.div`
  padding: 12px;
  background: var(--color-background-soft);
  border-radius: 6px;
  font-size: 12px;
  color: var(--color-text-2);
  line-height: 1.6;
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

// Export singleton instance
const TaskEditPopup = {
  show: (props: TaskEditPopupProps) => {
    window.topView?.push({
      element: <TaskEditPopupComponent {...props} />,
      id: `task-edit-${props.mode}-${Date.now()}`
    })
  },
  hide: () => {
    window.topView?.pop()
  }
}

export default TaskEditPopup
