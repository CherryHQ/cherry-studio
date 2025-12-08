import { loggerService } from '@logger'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { HelpTooltip } from '@renderer/components/TooltipIcons'
import { TopView } from '@renderer/components/TopView'
import { permissionModeCards } from '@renderer/config/agent'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import SelectAgentBaseModelButton from '@renderer/pages/home/components/SelectAgentBaseModelButton'
import type {
  AddAgentForm,
  AgentEntity,
  ApiModel,
  BaseAgentForm,
  PermissionMode,
  Tool,
  UpdateAgentForm
} from '@renderer/types'
import { AgentConfigurationSchema, isAgentType } from '@renderer/types'
import { Alert, Button, Input, Modal, Select } from 'antd'
import { AlertTriangleIcon } from 'lucide-react'
import type { ChangeEvent, FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const { TextArea } = Input

const logger = loggerService.withContext('AddAgentPopup')

type AgentWithTools = AgentEntity & { tools?: Tool[] }

const buildAgentForm = (existing?: AgentWithTools): BaseAgentForm => ({
  type: existing?.type ?? 'claude-code',
  name: existing?.name ?? 'Agent',
  description: existing?.description,
  instructions: existing?.instructions,
  model: existing?.model ?? '',
  accessible_paths: existing?.accessible_paths ? [...existing.accessible_paths] : [],
  allowed_tools: existing?.allowed_tools ? [...existing.allowed_tools] : [],
  mcps: existing?.mcps ? [...existing.mcps] : [],
  configuration: AgentConfigurationSchema.parse(existing?.configuration ?? {})
})

interface ShowParams {
  agent?: AgentWithTools
  afterSubmit?: (a: AgentEntity) => void
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ agent, afterSubmit, resolve }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const loadingRef = useRef(false)
  const { addAgent } = useAgents()
  const { updateAgent } = useUpdateAgent()
  const isEditing = (agent?: AgentWithTools) => agent !== undefined

  const [form, setForm] = useState<BaseAgentForm>(() => buildAgentForm(agent))
  const [hasGitBash, setHasGitBash] = useState<boolean>(true)

  useEffect(() => {
    if (open) {
      setForm(buildAgentForm(agent))
    }
  }, [agent, open])

  const checkGitBash = useCallback(
    async (showToast = false) => {
      try {
        const gitBashInstalled = await window.api.system.checkGitBash()
        setHasGitBash(gitBashInstalled)
        if (showToast) {
          if (gitBashInstalled) {
            window.toast.success(t('agent.gitBash.success', 'Git Bash detected successfully!'))
          } else {
            window.toast.error(t('agent.gitBash.notFound', 'Git Bash not found. Please install it first.'))
          }
        }
      } catch (error) {
        logger.error('Failed to check Git Bash:', error as Error)
        setHasGitBash(true) // Default to true on error to avoid false warnings
      }
    },
    [t]
  )

  useEffect(() => {
    checkGitBash()
  }, [checkGitBash])

  const selectedPermissionMode = form.configuration?.permission_mode ?? 'default'

  const onPermissionModeChange = useCallback((value: PermissionMode) => {
    setForm((prev) => {
      const parsedConfiguration = AgentConfigurationSchema.parse(prev.configuration ?? {})
      if (parsedConfiguration.permission_mode === value) {
        if (!prev.configuration) {
          return {
            ...prev,
            configuration: parsedConfiguration
          }
        }
        return prev
      }

      return {
        ...prev,
        configuration: {
          ...parsedConfiguration,
          permission_mode: value
        }
      }
    })
  }, [])

  const onNameChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({
      ...prev,
      name: e.target.value
    }))
  }, [])

  // const onDescChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
  //   setForm((prev) => ({
  //     ...prev,
  //     description: e.target.value
  //   }))
  // }, [])

  const onInstChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setForm((prev) => ({
      ...prev,
      instructions: e.target.value
    }))
  }, [])

  const addAccessiblePath = useCallback(async () => {
    try {
      const selected = await window.api.file.selectFolder()
      if (!selected) {
        return
      }
      setForm((prev) => {
        if (prev.accessible_paths.includes(selected)) {
          window.toast.warning(t('agent.session.accessible_paths.duplicate'))
          return prev
        }
        return {
          ...prev,
          accessible_paths: [...prev.accessible_paths, selected]
        }
      })
    } catch (error) {
      logger.error('Failed to select accessible path:', error as Error)
      window.toast.error(t('agent.session.accessible_paths.select_failed'))
    }
  }, [t])

  const removeAccessiblePath = useCallback((path: string) => {
    setForm((prev) => ({
      ...prev,
      accessible_paths: prev.accessible_paths.filter((item) => item !== path)
    }))
  }, [])

  // Create a temporary agentBase object for SelectAgentBaseModelButton
  const tempAgentBase: AgentEntity = useMemo(
    () => ({
      id: agent?.id ?? 'temp-creating',
      type: form.type,
      name: form.name,
      model: form.model,
      accessible_paths: form.accessible_paths.length > 0 ? form.accessible_paths : ['/'],
      allowed_tools: form.allowed_tools ?? [],
      description: form.description,
      instructions: form.instructions,
      configuration: form.configuration,
      created_at: agent?.created_at ?? new Date().toISOString(),
      updated_at: agent?.updated_at ?? new Date().toISOString()
    }),
    [form, agent?.id, agent?.created_at, agent?.updated_at]
  )

  const handleModelSelect = useCallback(async (model: ApiModel) => {
    setForm((prev) => ({ ...prev, model: model.id }))
  }, [])

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      if (loadingRef.current) {
        return
      }

      loadingRef.current = true

      // Additional validation check besides native HTML validation to ensure security
      if (!isAgentType(form.type)) {
        window.toast.error(t('agent.add.error.invalid_agent'))
        loadingRef.current = false
        return
      }
      if (!form.model) {
        window.toast.error(t('error.model.not_exists'))
        loadingRef.current = false
        return
      }

      if (form.accessible_paths.length === 0) {
        window.toast.error(t('agent.session.accessible_paths.error.at_least_one'))
        loadingRef.current = false
        return
      }

      if (isEditing(agent)) {
        if (!agent) {
          loadingRef.current = false
          throw new Error('Agent is required for editing mode')
        }

        const updatePayload = {
          id: agent.id,
          name: form.name,
          description: form.description,
          instructions: form.instructions,
          model: form.model,
          accessible_paths: [...form.accessible_paths],
          allowed_tools: [...form.allowed_tools],
          configuration: form.configuration ? { ...form.configuration } : undefined
        } satisfies UpdateAgentForm

        const result = await updateAgent(updatePayload)
        if (result) {
          logger.debug('Updated agent', result)
          afterSubmit?.(result)
        } else {
          logger.error('Update failed.')
        }
      } else {
        const newAgent = {
          type: form.type,
          name: form.name,
          description: form.description,
          instructions: form.instructions,
          model: form.model,
          accessible_paths: [...form.accessible_paths],
          allowed_tools: [...form.allowed_tools],
          configuration: form.configuration ? { ...form.configuration } : undefined
        } satisfies AddAgentForm
        const result = await addAgent(newAgent)

        if (!result.success) {
          loadingRef.current = false
          throw result.error
        }
        afterSubmit?.(result.data)
      }
      loadingRef.current = false
      setOpen(false)
    },
    [
      form.type,
      form.model,
      form.accessible_paths,
      form.name,
      form.description,
      form.instructions,
      form.allowed_tools,
      form.configuration,
      agent,
      t,
      updateAgent,
      afterSubmit,
      addAgent
    ]
  )

  AgentModalPopup.hide = onCancel

  return (
    <ErrorBoundary>
      <Modal
        title={isEditing(agent) ? t('agent.edit.title') : t('agent.add.title')}
        open={open}
        onCancel={onCancel}
        afterClose={onClose}
        transitionName="animation-move-down"
        centered
        width={500}
        footer={null}>
        <StyledForm onSubmit={onSubmit}>
          <FormContent>
            {!hasGitBash && (
              <Alert
                message={t('agent.gitBash.error.title', 'Git Bash Required')}
                description={
                  <div>
                    <div style={{ marginBottom: 8 }}>
                      {t(
                        'agent.gitBash.error.description',
                        'Git Bash is required to run agents on Windows. The agent cannot function without it. Please install Git for Windows from'
                      )}{' '}
                      <a
                        href="https://git-scm.com/download/win"
                        onClick={(e) => {
                          e.preventDefault()
                          window.api.openWebsite('https://git-scm.com/download/win')
                        }}
                        style={{ textDecoration: 'underline' }}>
                        git-scm.com
                      </a>
                    </div>
                    <Button size="small" onClick={() => checkGitBash(true)}>
                      {t('agent.gitBash.error.recheck', 'Recheck Git Bash Installation')}
                    </Button>
                  </div>
                }
                type="error"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}
            <FormRow>
              <FormItem style={{ flex: 1 }}>
                <Label>
                  {t('common.name')} <RequiredMark>*</RequiredMark>
                </Label>
                <Input value={form.name} onChange={onNameChange} required />
              </FormItem>
            </FormRow>

            <FormItem>
              <div className="flex items-center gap-2">
                <Label>
                  {t('common.model')} <RequiredMark>*</RequiredMark>
                </Label>
                <HelpTooltip title={t('agent.add.model.tooltip')} />
              </div>
              <SelectAgentBaseModelButton
                agentBase={tempAgentBase}
                onSelect={handleModelSelect}
                fontSize={14}
                avatarSize={24}
                iconSize={16}
                buttonStyle={{
                  padding: '3px 8px',
                  width: '100%',
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  height: 'auto'
                }}
                containerClassName="flex items-center justify-between w-full"
              />
            </FormItem>

            <FormItem>
              <Label>
                {t('agent.settings.tooling.permissionMode.title', 'Permission mode')} <RequiredMark>*</RequiredMark>
              </Label>
              <Select
                value={selectedPermissionMode}
                onChange={onPermissionModeChange}
                style={{ width: '100%' }}
                placeholder={t('agent.settings.tooling.permissionMode.placeholder', 'Select permission mode')}
                optionLabelProp="label">
                {permissionModeCards.map((item) => (
                  <Select.Option key={item.mode} value={item.mode} label={t(item.titleKey, item.titleFallback)}>
                    <PermissionOptionWrapper>
                      <div className="title">{t(item.titleKey, item.titleFallback)}</div>
                      <div className="description">{t(item.descriptionKey, item.descriptionFallback)}</div>
                      <div className="behavior">{t(item.behaviorKey, item.behaviorFallback)}</div>
                      {item.caution && (
                        <div className="caution">
                          <AlertTriangleIcon size={12} />
                          {t(
                            'agent.settings.tooling.permissionMode.bypassPermissions.warning',
                            'Use with caution — all tools will run without asking for approval.'
                          )}
                        </div>
                      )}
                    </PermissionOptionWrapper>
                  </Select.Option>
                ))}
              </Select>
              <HelpText>
                {t('agent.settings.tooling.permissionMode.helper', 'Choose how the agent handles tool approvals.')}
              </HelpText>
            </FormItem>

            <FormItem>
              <LabelWithButton>
                <Label>
                  {t('agent.session.accessible_paths.label')} <RequiredMark>*</RequiredMark>
                </Label>
                <Button size="small" onClick={addAccessiblePath}>
                  {t('agent.session.accessible_paths.add')}
                </Button>
              </LabelWithButton>
              {form.accessible_paths.length > 0 ? (
                <PathList>
                  {form.accessible_paths.map((path) => (
                    <PathItem key={path}>
                      <PathText title={path}>{path}</PathText>
                      <Button size="small" danger onClick={() => removeAccessiblePath(path)}>
                        {t('common.delete')}
                      </Button>
                    </PathItem>
                  ))}
                </PathList>
              ) : (
                <EmptyText>{t('agent.session.accessible_paths.empty')}</EmptyText>
              )}
            </FormItem>

            <FormItem>
              <Label>{t('common.prompt')}</Label>
              <TextArea rows={3} value={form.instructions ?? ''} onChange={onInstChange} />
            </FormItem>

            {/* <FormItem>
              <Label>{t('common.description')}</Label>
              <TextArea rows={1} value={form.description ?? ''} onChange={onDescChange} />
            </FormItem> */}
          </FormContent>

          <FormFooter>
            <Button onClick={onCancel}>{t('common.close')}</Button>
            <Button type="primary" htmlType="submit" loading={loadingRef.current} disabled={!hasGitBash}>
              {isEditing(agent) ? t('common.confirm') : t('common.add')}
            </Button>
          </FormFooter>
        </StyledForm>
      </Modal>
    </ErrorBoundary>
  )
}

const TopViewKey = 'AgentModalPopup'

export default class AgentModalPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}

// Keep the old export for backward compatibility during migration
export const AgentModal = AgentModalPopup

const StyledForm = styled.form`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const FormContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 60vh;
  overflow-y: auto;
  padding-right: 8px;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    background-color: var(--color-border);
    border-radius: 3px;
  }
`

const FormRow = styled.div`
  display: flex;
  gap: 12px;
`

const FormItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const Label = styled.label`
  font-size: 14px;
  color: var(--color-text-1);
  font-weight: 500;
`

const RequiredMark = styled.span`
  color: #ff4d4f;
  margin-left: 4px;
`

const HelpText = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
`

const LabelWithButton = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`

const PathList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const PathItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background-color: var(--color-bg-1);
`

const PathText = styled.span`
  flex: 1;
  font-size: 13px;
  color: var(--color-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const EmptyText = styled.p`
  font-size: 13px;
  color: var(--color-text-3);
  margin: 0;
`

const FormFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px;
`

const PermissionOptionWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 0;

  .title {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-1);
    margin-bottom: 2px;
  }

  .description {
    font-size: 12px;
    color: var(--color-text-2);
    line-height: 1.4;
  }

  .behavior {
    font-size: 12px;
    color: var(--color-text-3);
    line-height: 1.4;
  }

  .caution {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: 12px;
    color: #ff4d4f;
    margin-top: 4px;
    padding: 6px 8px;
    background-color: rgba(255, 77, 79, 0.1);
    border-radius: 4px;

    svg {
      flex-shrink: 0;
      margin-top: 2px;
    }
  }
`
