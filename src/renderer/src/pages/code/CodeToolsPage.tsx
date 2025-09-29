import { Button, Tooltip } from '@cherrystudio/ui'
import AiProvider from '@renderer/aiCore'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import ModelSelector from '@renderer/components/ModelSelector'
import { isMac, isWin } from '@renderer/config/constant'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@renderer/config/models'
import { getProviderLogo } from '@renderer/config/providers'
import { useCodeTools } from '@renderer/hooks/useCodeTools'
import { useAllProviders, useProviders } from '@renderer/hooks/useProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import { getProviderLabel } from '@renderer/i18n/label'
import { getProviderByModel } from '@renderer/services/AssistantService'
import { loggerService } from '@renderer/services/LoggerService'
import { getModelUniqId } from '@renderer/services/ModelService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setIsBunInstalled } from '@renderer/store/mcp'
import type { EndpointType, Model } from '@renderer/types'
import type { TerminalConfig } from '@shared/config/constant'
import { codeTools, terminalApps } from '@shared/config/constant'
import { Alert, Avatar, Checkbox, Input, Popover, Select, Space } from 'antd'
import { ArrowUpRight, Download, FolderOpen, HelpCircle, Terminal, X } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import {
  CLAUDE_OFFICIAL_SUPPORTED_PROVIDERS,
  CLI_TOOL_PROVIDER_MAP,
  CLI_TOOLS,
  generateToolEnvironment,
  getClaudeSupportedProviders,
  OPENAI_CODEX_SUPPORTED_PROVIDERS,
  parseEnvironmentVariables
} from '.'

const logger = loggerService.withContext('CodeToolsPage')

const CodeToolsPage: FC = () => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const allProviders = useAllProviders()
  const dispatch = useAppDispatch()
  const isBunInstalled = useAppSelector((state) => state.mcp.isBunInstalled)
  const {
    selectedCliTool,
    selectedModel,
    selectedTerminal,
    environmentVariables,
    directories,
    currentDirectory,
    canLaunch,
    setCliTool,
    setModel,
    setTerminal,
    setEnvVars,
    setCurrentDir,
    removeDir,
    selectFolder
  } = useCodeTools()
  const { setTimeoutTimer } = useTimer()

  const [isLaunching, setIsLaunching] = useState(false)
  const [isInstallingBun, setIsInstallingBun] = useState(false)
  const [autoUpdateToLatest, setAutoUpdateToLatest] = useState(false)
  const [availableTerminals, setAvailableTerminals] = useState<TerminalConfig[]>([])
  const [isLoadingTerminals, setIsLoadingTerminals] = useState(false)
  const [terminalCustomPaths, setTerminalCustomPaths] = useState<Record<string, string>>({})

  const modelPredicate = useCallback(
    (m: Model) => {
      if (isEmbeddingModel(m) || isRerankModel(m) || isTextToImageModel(m)) {
        return false
      }

      if (m.provider === 'cherryai') {
        return false
      }

      if (selectedCliTool === codeTools.claudeCode) {
        if (m.supported_endpoint_types) {
          return m.supported_endpoint_types.includes('anthropic')
        }
        return m.id.includes('claude') || CLAUDE_OFFICIAL_SUPPORTED_PROVIDERS.includes(m.provider)
      }

      if (selectedCliTool === codeTools.geminiCli) {
        if (m.supported_endpoint_types) {
          return m.supported_endpoint_types.includes('gemini')
        }
        return m.id.includes('gemini')
      }

      if (selectedCliTool === codeTools.openaiCodex) {
        if (m.supported_endpoint_types) {
          return ['openai', 'openai-response'].some((type) =>
            m.supported_endpoint_types?.includes(type as EndpointType)
          )
        }
        return m.id.includes('openai') || OPENAI_CODEX_SUPPORTED_PROVIDERS.includes(m.provider)
      }

      if (selectedCliTool === codeTools.qwenCode || selectedCliTool === codeTools.iFlowCli) {
        if (m.supported_endpoint_types) {
          return ['openai', 'openai-response'].some((type) =>
            m.supported_endpoint_types?.includes(type as EndpointType)
          )
        }
        return true
      }

      return true
    },
    [selectedCliTool]
  )

  const availableProviders = useMemo(() => {
    const filterFn = CLI_TOOL_PROVIDER_MAP[selectedCliTool]
    return filterFn ? filterFn(providers) : []
  }, [providers, selectedCliTool])

  const handleModelChange = (value: string) => {
    if (!value) {
      setModel(null)
      return
    }

    // 从所有 providers 中查找选中的模型
    for (const provider of providers || []) {
      const model = provider.models.find((m) => getModelUniqId(m) === value)
      if (model) {
        setModel(model)
        break
      }
    }
  }

  // 处理删除目录
  const handleRemoveDirectory = (directory: string, e: React.MouseEvent) => {
    e.stopPropagation()
    removeDir(directory)
  }

  // 检查 bun 是否安装
  const checkBunInstallation = useCallback(async () => {
    try {
      const bunExists = await window.api.isBinaryExist('bun')
      dispatch(setIsBunInstalled(bunExists))
    } catch (error) {
      logger.error('Failed to check bun installation status:', error as Error)
      dispatch(setIsBunInstalled(false))
    }
  }, [dispatch])

  // 获取可用终端
  const loadAvailableTerminals = useCallback(async () => {
    if (!isMac && !isWin) return // 仅 macOS 和 Windows 支持

    try {
      setIsLoadingTerminals(true)
      const terminals = await window.api.codeTools.getAvailableTerminals()
      setAvailableTerminals(terminals)
      logger.info(
        `Found ${terminals.length} available terminals:`,
        terminals.map((t) => t.name)
      )
    } catch (error) {
      logger.error('Failed to load available terminals:', error as Error)
      setAvailableTerminals([])
    } finally {
      setIsLoadingTerminals(false)
    }
  }, [])

  // 安装 bun
  const handleInstallBun = async () => {
    try {
      setIsInstallingBun(true)
      await window.api.installBunBinary()
      dispatch(setIsBunInstalled(true))
      window.toast.success(t('settings.mcp.installSuccess'))
    } catch (error: any) {
      logger.error('Failed to install bun:', error as Error)
      window.toast.error(`${t('settings.mcp.installError')}: ${error.message}`)
    } finally {
      setIsInstallingBun(false)
      // 重新检查安装状态
      setTimeoutTimer('handleInstallBun', checkBunInstallation, 1000)
    }
  }

  // 验证启动条件
  const validateLaunch = (): { isValid: boolean; message?: string } => {
    if (!canLaunch || !isBunInstalled) {
      return {
        isValid: false,
        message: !isBunInstalled ? t('code.launch.bun_required') : t('code.launch.validation_error')
      }
    }

    if (!selectedModel) {
      return { isValid: false, message: t('code.model_required') }
    }

    return { isValid: true }
  }

  // 准备启动环境
  const prepareLaunchEnvironment = async (): Promise<Record<string, string> | null> => {
    if (!selectedModel) return null

    const modelProvider = getProviderByModel(selectedModel)
    const aiProvider = new AiProvider(modelProvider)
    const baseUrl = aiProvider.getBaseURL()
    const apiKey = aiProvider.getApiKey()

    // 生成工具特定的环境变量
    const toolEnv = generateToolEnvironment({
      tool: selectedCliTool,
      model: selectedModel,
      modelProvider,
      apiKey,
      baseUrl
    })

    // 合并用户自定义的环境变量
    const userEnv = parseEnvironmentVariables(environmentVariables)

    return { ...toolEnv, ...userEnv }
  }

  // 执行启动操作
  const executeLaunch = async (env: Record<string, string>) => {
    window.api.codeTools.run(selectedCliTool, selectedModel?.id!, currentDirectory, env, {
      autoUpdateToLatest,
      terminal: selectedTerminal
    })
    window.toast.success(t('code.launch.success'))
  }

  // 设置终端自定义路径
  const handleSetCustomPath = async (terminalId: string) => {
    try {
      const result = await window.api.file.select({
        properties: ['openFile'],
        filters: [
          { name: 'Executable', extensions: ['exe'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (result && result.length > 0) {
        const path = result[0].path
        await window.api.codeTools.setCustomTerminalPath(terminalId, path)
        setTerminalCustomPaths((prev) => ({ ...prev, [terminalId]: path }))
        window.toast.success(t('code.custom_path_set'))
        // Reload terminals to reflect changes
        loadAvailableTerminals()
      }
    } catch (error) {
      logger.error('Failed to set custom terminal path:', error as Error)
      window.toast.error(t('code.custom_path_error'))
    }
  }

  // 处理启动
  const handleLaunch = async () => {
    const validation = validateLaunch()

    if (!validation.isValid) {
      window.toast.warning(validation.message || t('code.launch.validation_error'))
      return
    }

    setIsLaunching(true)

    try {
      const env = await prepareLaunchEnvironment()
      if (!env) {
        window.toast.error(t('code.model_required'))
        return
      }

      await executeLaunch(env)
    } catch (error) {
      logger.error('start code tools failed:', error as Error)
      window.toast.error(t('code.launch.error'))
    } finally {
      setIsLaunching(false)
    }
  }

  // 页面加载时检查 bun 安装状态
  useEffect(() => {
    checkBunInstallation()
  }, [checkBunInstallation])

  // 页面加载时获取可用终端
  useEffect(() => {
    loadAvailableTerminals()
  }, [loadAvailableTerminals])

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('code.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <MainContent>
          <Title>{t('code.title')}</Title>
          <Description>{t('code.description')}</Description>

          {/* Bun 安装状态提示 */}
          {!isBunInstalled && (
            <BunInstallAlert>
              <Alert
                type="warning"
                banner
                style={{ borderRadius: 'var(--list-item-border-radius)' }}
                message={
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{t('code.bun_required_message')}</span>
                    <Button
                      color="primary"
                      size="sm"
                      startContent={<Download size={14} />}
                      onPress={handleInstallBun}
                      isLoading={isInstallingBun}
                      isDisabled={isInstallingBun}>
                      {isInstallingBun ? t('code.installing_bun') : t('code.install_bun')}
                    </Button>
                  </div>
                }
              />
            </BunInstallAlert>
          )}

          <SettingsPanel>
            <SettingsItem>
              <div className="settings-label">{t('code.cli_tool')}</div>
              <Select
                style={{ width: '100%' }}
                placeholder={t('code.cli_tool_placeholder')}
                value={selectedCliTool}
                onChange={setCliTool}
                options={CLI_TOOLS}
              />
            </SettingsItem>

            <SettingsItem>
              <div className="settings-label">
                {t('code.model')}
                {selectedCliTool === 'claude-code' && (
                  <Popover
                    content={
                      <div style={{ width: 200 }}>
                        <div style={{ marginBottom: 8, fontWeight: 500 }}>{t('code.supported_providers')}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {getClaudeSupportedProviders(allProviders).map((provider) => {
                            return (
                              <Link
                                key={provider.id}
                                style={{ color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 4 }}
                                to={`/settings/provider?id=${provider.id}`}>
                                <ProviderLogo shape="square" src={getProviderLogo(provider.id)} size={20} />
                                {getProviderLabel(provider.id)}
                                <ArrowUpRight size={14} />
                              </Link>
                            )
                          })}
                        </div>
                      </div>
                    }
                    trigger="hover"
                    placement="right">
                    <HelpCircle size={14} style={{ color: 'var(--color-text-3)', cursor: 'pointer' }} />
                  </Popover>
                )}
              </div>
              <ModelSelector
                providers={availableProviders}
                predicate={modelPredicate}
                style={{ width: '100%' }}
                placeholder={t('code.model_placeholder')}
                value={selectedModel ? getModelUniqId(selectedModel) : undefined}
                onChange={handleModelChange}
                allowClear
              />
            </SettingsItem>

            <SettingsItem>
              <div className="settings-label">{t('code.working_directory')}</div>
              <Space.Compact style={{ width: '100%', display: 'flex' }}>
                <Select
                  style={{ flex: 1, width: 480 }}
                  placeholder={t('code.folder_placeholder')}
                  value={currentDirectory || undefined}
                  onChange={setCurrentDir}
                  allowClear
                  showSearch
                  filterOption={(input, option) => {
                    const label = typeof option?.label === 'string' ? option.label : String(option?.value || '')
                    return label.toLowerCase().includes(input.toLowerCase())
                  }}
                  options={directories.map((dir) => ({
                    value: dir,
                    label: (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{dir}</span>
                        <X
                          size={14}
                          style={{ marginLeft: 8, cursor: 'pointer', color: '#999' }}
                          onClick={(e) => handleRemoveDirectory(dir, e)}
                        />
                      </div>
                    )
                  }))}
                />
                <Button onClick={selectFolder} style={{ width: 120 }}>
                  {t('code.select_folder')}
                </Button>
              </Space.Compact>
            </SettingsItem>

            <SettingsItem>
              <div className="settings-label">{t('code.environment_variables')}</div>
              <Input.TextArea
                placeholder={`KEY1=value1\nKEY2=value2`}
                value={environmentVariables}
                onChange={(e) => setEnvVars(e.target.value)}
                rows={2}
                style={{ fontFamily: 'monospace' }}
              />
              <div style={{ fontSize: 12, color: 'var(--color-text-3)', marginTop: 4 }}>{t('code.env_vars_help')}</div>
            </SettingsItem>

            {/* 终端选择 (macOS 和 Windows) */}
            {(isMac || isWin) && availableTerminals.length > 0 && (
              <SettingsItem>
                <div className="settings-label">{t('code.terminal')}</div>
                <Space.Compact style={{ width: '100%', display: 'flex' }}>
                  <Select
                    style={{ flex: 1 }}
                    placeholder={t('code.terminal_placeholder')}
                    value={selectedTerminal}
                    onChange={setTerminal}
                    loading={isLoadingTerminals}
                    options={availableTerminals.map((terminal) => ({
                      value: terminal.id,
                      label: terminal.name
                    }))}
                  />
                  {/* Show custom path button for Windows terminals except cmd/powershell */}
                  {isWin &&
                    selectedTerminal &&
                    selectedTerminal !== terminalApps.cmd &&
                    selectedTerminal !== terminalApps.powershell &&
                    selectedTerminal !== terminalApps.windowsTerminal && (
                      <Tooltip
                        placement="top"
                        title={terminalCustomPaths[selectedTerminal] || t('code.set_custom_path')}>
                        <Button
                          startContent={<FolderOpen size={16} />}
                          isIconOnly
                          onPress={() => handleSetCustomPath(selectedTerminal)}
                        />
                      </Tooltip>
                    )}
                </Space.Compact>
                {isWin &&
                  selectedTerminal &&
                  selectedTerminal !== terminalApps.cmd &&
                  selectedTerminal !== terminalApps.powershell &&
                  selectedTerminal !== terminalApps.windowsTerminal && (
                    <div style={{ fontSize: 12, color: 'var(--color-text-3)', marginTop: 4 }}>
                      {terminalCustomPaths[selectedTerminal]
                        ? `${t('code.custom_path')}: ${terminalCustomPaths[selectedTerminal]}`
                        : t('code.custom_path_required')}
                    </div>
                  )}
              </SettingsItem>
            )}

            <SettingsItem>
              <div className="settings-label">{t('code.update_options')}</div>
              <Checkbox checked={autoUpdateToLatest} onChange={(e) => setAutoUpdateToLatest(e.target.checked)}>
                {t('code.auto_update_to_latest')}
              </Checkbox>
            </SettingsItem>
          </SettingsPanel>

          <Button
            color="primary"
            startContent={<Terminal size={16} />}
            size="lg"
            onPress={handleLaunch}
            isLoading={isLaunching}
            isDisabled={!canLaunch || !isBunInstalled}
            fullWidth={true}>
            {isLaunching ? t('code.launching') : t('code.launch.label')}
          </Button>
        </MainContent>
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  overflow-y: auto;
  padding: 20px 0;
`

const MainContent = styled.div`
  width: 600px;
  margin: auto;
  min-height: fit-content;
`

const Title = styled.h1`
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--color-text-1);
`

const Description = styled.p`
  font-size: 14px;
  color: var(--color-text-2);
  margin-bottom: 32px;
  line-height: 1.5;
`

const SettingsPanel = styled.div`
  margin-bottom: 32px;
`

const SettingsItem = styled.div`
  margin-bottom: 24px;

  .settings-label {
    font-size: 14px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text-1);
    font-weight: 500;
  }
`

const BunInstallAlert = styled.div`
  margin-bottom: 24px;
`

const ProviderLogo = styled(Avatar)`
  border-radius: 4px;
`

export default CodeToolsPage
