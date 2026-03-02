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
import type { Assistant, Model, Provider } from '@renderer/types'
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

  // 本地状态管理智能规划开关
  const [enableSmartPlanning, setEnableSmartPlanning] = useState(true)
  // 本地状态管理规划模型
  const [planModel, setPlanModel] = useState<string | undefined>(undefined)

  const { assistants } = useAssistants()
  const { agents } = useAgents()

  // 获取可用的 providers 和 models
  const providers = useAppSelector((state) => state.llm.providers)
  const appLanguage = useAppSelector((state) => state.settings.language)

  const task = useAppSelector((state) => {
    if (mode === 'edit' && taskId) {
      return getTaskById(state)(taskId)
    }
    return null
  })

  useEffect(() => {
    if (open) {
      if (task && mode === 'edit') {
        const smartPlanningValue = task.execution.enableSmartPlanning ?? true
        setEnableSmartPlanning(smartPlanningValue)
        setPlanModel(task.execution.planModel)

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
        setEnableSmartPlanning(true)
        setPlanModel(undefined)

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
          notifyOnComplete: values.notifyOnComplete,
          enableSmartPlanning: enableSmartPlanning,
          planModel: planModel // 使用本地状态
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

  // 智能推荐模型：根据应用语言和模型能力推荐最佳模型
  const getRecommendedModels = () => {
    const isChinese = appLanguage?.startsWith('zh')
    const recommendations: string[] = []

    // 中文环境推荐模型
    if (isChinese) {
      // 优先推荐支持中文的模型
      providers.forEach((provider) => {
        if (!provider.enabled || !provider.models) return

        provider.models.forEach((model) => {
          const modelId = `${provider.id}:${model.id}`

          // 推荐中文优化的模型
          if (model.id.includes('gpt-4') || model.id.includes('claude-3') || model.id.includes('deepseek')) {
            recommendations.push(modelId)
          }
        })
      })
    } else {
      // 英文环境推荐模型
      providers.forEach((provider) => {
        if (!provider.enabled || !provider.models) return

        provider.models.forEach((model) => {
          const modelId = `${provider.id}:${model.id}`

          // 推荐英文优化的模型
          if (model.id.includes('gpt-4') || model.id.includes('claude-3') || model.id.includes('o1')) {
            recommendations.push(modelId)
          }
        })
      })
    }

    return recommendations
  }

  // 模型能力评分
  const getModelCapabilityScore = (modelId: string): number => {
    const [providerId, actualModelId] = modelId.split(':')

    let score = 50 // 基础分数

    // 根据模型ID评估能力
    if (actualModelId.includes('gpt-4')) {
      score += 30 // GPT-4 系列能力强
    } else if (actualModelId.includes('claude-3-5') || actualModelId.includes('claude-3.5')) {
      score += 35 // Claude 3.5 Sonnet 最强
    } else if (actualModelId.includes('claude-3')) {
      score += 25 // Claude 3 系列
    } else if (actualModelId.includes('gpt-3.5') || actualModelId.includes('gpt-35')) {
      score += 15 // GPT-3.5 中等
    } else if (actualModelId.includes('deepseek')) {
      score += 20 // DeepSeek 中文能力强
    }

    // 根据提供商评估
    if (providerId === 'anthropic') {
      score += 10 // Anthropic 模型在规划任务上表现出色
    } else if (providerId === 'openai') {
      score += 5
    }

    return Math.min(100, score)
  }

  // 生成增强的模型选项列表，包含分组和推荐标记
  const getEnhancedModelOptions = () => {
    const isChinese = appLanguage?.startsWith('zh')
    const recommendedModels = getRecommendedModels()

    // 所有可用模型
    const allModels = providers
      .filter((p) => p.enabled && p.models && p.models.length > 0)
      .flatMap((provider: Provider) => {
        return provider.models!.map((model: Model) => {
          const modelId = `${provider.id}:${model.id}`
          const isRecommended = recommendedModels.includes(modelId)
          const capabilityScore = getModelCapabilityScore(modelId)

          return {
            label: `${model.name} (${provider.name})`,
            value: modelId,
            isRecommended,
            capabilityScore,
            providerId: provider.id
          }
        })
      })

    // 按推荐状态和能力评分排序
    allModels.sort((a, b) => {
      // 首先按推荐状态排序
      if (a.isRecommended && !b.isRecommended) return -1
      if (!a.isRecommended && b.isRecommended) return 1
      // 然后按能力评分排序
      return b.capabilityScore - a.capabilityScore
    })

    // 创建分组选项
    const recommended = allModels.filter((m) => m.isRecommended)
    const others = allModels.filter((m) => !m.isRecommended)

    const options: any[] = []

    if (recommended.length > 0) {
      options.push({
        label: isChinese ? '⭐ 推荐模型' : '⭐ Recommended',
        options: recommended.map((m) => ({
          label: `${m.label}${m.capabilityScore >= 80 ? ' 🏆' : ''}`,
          value: m.value
        }))
      })
    }

    if (others.length > 0) {
      options.push({
        label: isChinese ? '其他模型' : 'Other Models',
        options: others.map((m) => ({
          label: m.label,
          value: m.value
        }))
      })
    }

    return options
  }

  const modelOptions = getEnhancedModelOptions()

  // 智能默认选择：自动选择推荐列表中的第一个模型
  useEffect(() => {
    if (enableSmartPlanning && !planModel && modelOptions.length > 0) {
      const recommendedModels = getRecommendedModels()
      if (recommendedModels.length > 0) {
        const firstRecommended = recommendedModels[0]
        setPlanModel(firstRecommended)
        console.log('[TaskEditPopup] Auto-selected recommended model:', firstRecommended)
      } else if (modelOptions.length > 0 && modelOptions[0].options?.length > 0) {
        const firstAvailable = modelOptions[0].options[0].value
        setPlanModel(firstAvailable)
        console.log('[TaskEditPopup] Auto-selected first available model:', firstAvailable)
      }
    }
  }, [enableSmartPlanning, modelOptions])

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

          <div style={{ marginBottom: 24 }}>
            <div style={{ marginBottom: 8, fontSize: 14, fontWeight: 500 }}>
              {t('tasks.form.enable_smart_planning')}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Switch
                checked={enableSmartPlanning}
                onChange={(checked) => {
                  setEnableSmartPlanning(checked)
                }}
              />
              <HelpText>{t('tasks.form.enable_smart_planning_help')}</HelpText>
            </div>
          </div>

          {enableSmartPlanning && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ marginBottom: 8, fontSize: 14, fontWeight: 500 }}>
                {t('tasks.form.plan_model')} <span style={{ color: 'var(--color-warning)' }}>*</span>
              </div>
              <Select
                style={{ width: '100%' }}
                placeholder={t('tasks.form.plan_model_placeholder')}
                value={planModel}
                onChange={(value) => setPlanModel(value)}
                options={modelOptions}
                showSearch
                filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              />
              <HelpText>
                {t('tasks.form.plan_model_help')}
                {planModel && (
                  <span style={{ marginLeft: 8, color: 'var(--color-primary)' }}>
                    {appLanguage?.startsWith('zh') ? '✓ 已选择模型' : '✓ Model selected'}
                  </span>
                )}
              </HelpText>
              {!planModel && modelOptions.length > 0 && (
                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-text-2)' }}>
                  {appLanguage?.startsWith('zh')
                    ? '💡 提示：系统已根据当前语言自动标记推荐模型'
                    : '💡 Tip: Recommended models are marked based on your language'}
                </div>
              )}
            </div>
          )}
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
