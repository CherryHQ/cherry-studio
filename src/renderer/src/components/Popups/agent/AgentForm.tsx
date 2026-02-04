import { loggerService } from '@logger'
import { HelpTooltip } from '@renderer/components/TooltipIcons'
import { permissionModeCards } from '@renderer/config/agent'
import { isWin } from '@renderer/config/constant'
import SelectAgentBaseModelButton from '@renderer/pages/home/components/SelectAgentBaseModelButton'
import type { AgentEntity, ApiModel, BaseAgentForm, PermissionMode } from '@renderer/types'
import { AgentConfigurationSchema } from '@renderer/types'
import type { GitBashPathInfo } from '@shared/config/constant'
import { Button, Input, Select } from 'antd'
import { AlertTriangleIcon, Trash2 } from 'lucide-react'
import type { ChangeEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('AgentForm')

export const buildAgentForm = (existing?: AgentEntity & { tools?: unknown[] }): BaseAgentForm => ({
  type: existing?.type ?? 'claude-code',
  name: existing?.name ?? 'Agent',
  description: existing?.description,
  model: existing?.model ?? '',
  accessible_paths: existing?.accessible_paths ? [...existing.accessible_paths] : [],
  allowed_tools: existing?.allowed_tools ? [...existing.allowed_tools] : [],
  mcps: existing?.mcps ? [...existing.mcps] : [],
  configuration: AgentConfigurationSchema.parse(existing?.configuration ?? {})
})

interface AgentFormProps {
  form: BaseAgentForm
  setForm: React.Dispatch<React.SetStateAction<BaseAgentForm>>
  agent?: AgentEntity
  onSubmit?: () => void
  loading?: boolean
}

const AgentForm: React.FC<AgentFormProps> = ({ form, setForm, agent, onSubmit, loading }) => {
  const { t } = useTranslation()
  const [gitBashPathInfo, setGitBashPathInfo] = useState<GitBashPathInfo>({ path: null, source: null })

  const checkGitBash = useCallback(async () => {
    if (!isWin) return
    try {
      const pathInfo = await window.api.system.getGitBashPathInfo()
      setGitBashPathInfo(pathInfo)
    } catch (error) {
      logger.error('Failed to check Git Bash:', error as Error)
    }
  }, [])

  useEffect(() => {
    checkGitBash()
  }, [checkGitBash])

  const selectedPermissionMode = form.configuration?.permission_mode ?? 'default'

  const handlePickGitBash = useCallback(async () => {
    try {
      const selected = await window.api.file.select({
        title: t('agent.gitBash.pick.title', 'Select Git Bash executable'),
        filters: [{ name: 'Executable', extensions: ['exe'] }],
        properties: ['openFile']
      })

      if (!selected || selected.length === 0) {
        return
      }

      const pickedPath = selected[0].path
      const ok = await window.api.system.setGitBashPath(pickedPath)
      if (!ok) {
        window.toast.error(
          t('agent.gitBash.pick.invalidPath', 'Selected file is not a valid Git Bash executable (bash.exe).')
        )
        return
      }

      await checkGitBash()
    } catch (error) {
      logger.error('Failed to pick Git Bash path', error as Error)
      window.toast.error(t('agent.gitBash.pick.failed', 'Failed to set Git Bash path'))
    }
  }, [checkGitBash, t])

  const handleResetGitBash = useCallback(async () => {
    try {
      await window.api.system.setGitBashPath(null)
      await checkGitBash()
    } catch (error) {
      logger.error('Failed to reset Git Bash path', error as Error)
    }
  }, [checkGitBash])

  const onPermissionModeChange = useCallback(
    (value: PermissionMode) => {
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
    },
    [setForm]
  )

  const onNameChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({
        ...prev,
        name: e.target.value
      }))
    },
    [setForm]
  )

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
  }, [t, setForm])

  const removeAccessiblePath = useCallback(
    (path: string) => {
      setForm((prev) => ({
        ...prev,
        accessible_paths: prev.accessible_paths.filter((item) => item !== path)
      }))
    },
    [setForm]
  )

  const tempAgentBase: AgentEntity = useMemo(
    () => ({
      id: agent?.id ?? 'temp-creating',
      type: form.type,
      name: form.name,
      model: form.model,
      accessible_paths: form.accessible_paths.length > 0 ? form.accessible_paths : ['/'],
      allowed_tools: form.allowed_tools ?? [],
      description: form.description,
      configuration: form.configuration,
      created_at: agent?.created_at ?? new Date().toISOString(),
      updated_at: agent?.updated_at ?? new Date().toISOString()
    }),
    [form, agent?.id, agent?.created_at, agent?.updated_at]
  )

  const handleModelSelect = useCallback(
    async (model: ApiModel) => {
      setForm((prev) => ({ ...prev, model: model.id }))
    },
    [setForm]
  )

  return (
    <FormContent>
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

      {isWin && (
        <FormItem>
          <div className="flex items-center gap-2">
            <Label>
              Git Bash <RequiredMark>*</RequiredMark>
            </Label>
            <HelpTooltip
              title={t(
                'agent.gitBash.tooltip',
                'Git Bash is required to run agents on Windows. Install from git-scm.com if not available.'
              )}
            />
          </div>
          <GitBashInputWrapper>
            <Input
              value={gitBashPathInfo.path ?? ''}
              readOnly
              placeholder={t('agent.gitBash.placeholder', 'Select bash.exe path')}
            />
            <Button size="small" onClick={handlePickGitBash}>
              {t('common.select', 'Select')}
            </Button>
            {gitBashPathInfo.source === 'manual' && (
              <Button size="small" onClick={handleResetGitBash}>
                {t('common.reset', 'Reset')}
              </Button>
            )}
          </GitBashInputWrapper>
          {gitBashPathInfo.path && gitBashPathInfo.source === 'auto' && (
            <SourceHint>{t('agent.gitBash.autoDiscoveredHint', 'Auto-discovered')}</SourceHint>
          )}
        </FormItem>
      )}

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
                <Trash2
                  size={16}
                  className="cursor-pointer text-[var(--color-error)] hover:opacity-80"
                  onClick={() => removeAccessiblePath(path)}
                />
              </PathItem>
            ))}
          </PathList>
        ) : (
          <EmptyText>{t('agent.session.accessible_paths.empty')}</EmptyText>
        )}
      </FormItem>

      {onSubmit && (
        <FormItem>
          <Button type="primary" variant="outlined" onClick={onSubmit} loading={loading} block>
            {t('common.add')}
          </Button>
        </FormItem>
      )}
    </FormContent>
  )
}

export default AgentForm

// Styled components
const FormContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
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

const GitBashInputWrapper = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;

  input {
    flex: 1;
  }
`

const SourceHint = styled.span`
  font-size: 12px;
  color: var(--color-text-3);
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
  padding: 8px 0;
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
