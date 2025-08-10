import AiProvider from '@renderer/aiCore'
import ModelSelector from '@renderer/components/ModelSelector'
import { useCodeTools } from '@renderer/hooks/useCodeTools'
import { useProviders } from '@renderer/hooks/useProvider'
import { getProviderByModel } from '@renderer/services/AssistantService'
import { loggerService } from '@renderer/services/LoggerService'
import { getModelUniqId } from '@renderer/services/ModelService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setIsBunInstalled } from '@renderer/store/mcp'
import { Alert, Button, Checkbox, Select, Space } from 'antd'
import { Download, Terminal, X } from 'lucide-react'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

// CLI 工具选项
const CLI_TOOLS = [
  { value: 'qwen-code', label: 'Qwen Code' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'gemini-cli', label: 'Gemini CLI' }
]

const logger = loggerService.withContext('CodePage')

const CodePage: FC = () => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const dispatch = useAppDispatch()
  const isBunInstalled = useAppSelector((state) => state.mcp.isBunInstalled)
  const {
    selectedCliTool,
    selectedModel,
    directories,
    currentDirectory,
    canLaunch,
    setCliTool,
    setModel,
    setCurrentDir,
    removeDir,
    selectFolder
  } = useCodeTools()

  // 状态管理
  const [isLaunching, setIsLaunching] = useState(false)
  const [isInstallingBun, setIsInstallingBun] = useState(false)
  const [checkUpdate, setCheckUpdate] = useState(true)
  const [forceUpdate, setForceUpdate] = useState(false)

  // 处理 CLI 工具选择
  const handleCliToolChange = (value: string) => {
    setCliTool(value)
    setModel(null)
  }

  const openAiProviders = providers.filter((p) => p.type.includes('openai'))
  const geminiProviders = providers.filter((p) => p.type === 'gemini')
  const claudeProviders = providers.filter((p) => p.type === 'anthropic')

  const availableProviders =
    selectedCliTool === 'claude-code'
      ? claudeProviders
      : selectedCliTool === 'gemini-cli'
        ? geminiProviders
        : openAiProviders

  // 处理模型选择
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

  // 处理文件夹选择
  const handleFolderSelect = async () => {
    try {
      await selectFolder()
    } catch (error) {
      logger.error('选择文件夹失败:', error as Error)
    }
  }

  // 处理目录选择
  const handleDirectoryChange = (value: string) => {
    setCurrentDir(value)
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
      logger.error('检查 bun 安装状态失败:', error as Error)
      dispatch(setIsBunInstalled(false))
    }
  }, [dispatch])

  // 安装 bun
  const handleInstallBun = async () => {
    try {
      setIsInstallingBun(true)
      await window.api.installBunBinary()
      dispatch(setIsBunInstalled(true))
      window.message.success({
        content: t('settings.mcp.installSuccess'),
        key: 'bun-install-message'
      })
    } catch (error: any) {
      logger.error('安装 bun 失败:', error as Error)
      window.message.error({
        content: `${t('settings.mcp.installError')}: ${error.message}`,
        key: 'bun-install-message'
      })
    } finally {
      setIsInstallingBun(false)
      // 重新检查安装状态
      setTimeout(checkBunInstallation, 1000)
    }
  }

  // 处理启动
  const handleLaunch = async () => {
    if (!canLaunch || !isBunInstalled) {
      if (!isBunInstalled) {
        window.message.warning({
          content: t('code.launch.bun_required'),
          key: 'code-launch-message'
        })
      } else {
        window.message.warning({
          content: t('code.launch.validation_error'),
          key: 'code-launch-message'
        })
      }
      return
    }

    setIsLaunching(true)

    if (!selectedModel) {
      window.message.error({
        content: t('code.model_required'),
        key: 'code-launch-message'
      })
      return
    }

    const modelProvider = getProviderByModel(selectedModel)
    const aiProvider = new AiProvider(modelProvider)
    const baseUrl = await aiProvider.getBaseURL()
    const apiKey = await aiProvider.getApiKey()

    let env: Record<string, string> = {}
    if (selectedCliTool === 'claude-code') {
      env = {
        ANTHROPIC_API_KEY: apiKey,
        ANTHROPIC_MODEL: selectedModel.id
      }
    }

    if (selectedCliTool === 'gemini-cli') {
      env = {
        GEMINI_API_KEY: apiKey
      }
    }

    if (selectedCliTool === 'qwen-code') {
      env = {
        OPENAI_API_KEY: apiKey,
        OPENAI_BASE_URL: baseUrl,
        OPENAI_MODEL: selectedModel.id
      }
    }

    try {
      // 这里可以添加实际的启动逻辑
      logger.info('启动配置:', {
        cliTool: selectedCliTool,
        model: selectedModel,
        folder: currentDirectory
      })

      window.api.codeTools.run(selectedCliTool, selectedModel?.id, currentDirectory, env, {
        checkUpdate,
        forceUpdate
      })

      window.message.success({
        content: t('code.launch.success'),
        key: 'code-launch-message'
      })
    } catch (error) {
      logger.error('启动失败:', error as Error)
      window.message.error({
        content: t('code.launch.error'),
        key: 'code-launch-message'
      })
    } finally {
      setIsLaunching(false)
    }
  }

  // 页面加载时检查 bun 安装状态
  useEffect(() => {
    checkBunInstallation()
  }, [checkBunInstallation])

  return (
    <Container>
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
                  type="primary"
                  size="small"
                  icon={<Download size={14} />}
                  onClick={handleInstallBun}
                  loading={isInstallingBun}
                  disabled={isInstallingBun}>
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
            onChange={handleCliToolChange}
            options={CLI_TOOLS}
          />
        </SettingsItem>

        <SettingsItem>
          <div className="settings-label">{t('code.model')}</div>
          <ModelSelector
            providers={availableProviders}
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
              onChange={handleDirectoryChange}
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
            <Button onClick={handleFolderSelect} style={{ width: 120 }}>
              {t('code.select_folder')}
            </Button>
          </Space.Compact>
        </SettingsItem>

        <SettingsItem>
          <div className="settings-label">{t('code.update_options')}</div>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Checkbox checked={checkUpdate} onChange={(e) => setCheckUpdate(e.target.checked)}>
              {t('code.check_update')}
            </Checkbox>
            <Checkbox checked={forceUpdate} onChange={(e) => setForceUpdate(e.target.checked)} disabled={!checkUpdate}>
              {t('code.force_update')}
            </Checkbox>
          </Space>
        </SettingsItem>
      </SettingsPanel>

      <Button
        type="primary"
        icon={<Terminal size={16} />}
        size="large"
        onClick={handleLaunch}
        loading={isLaunching}
        disabled={!canLaunch || !isBunInstalled}
        block>
        {isLaunching ? t('code.launching') : t('code.launch.label')}
      </Button>
    </Container>
  )
}

// 样式组件
const Container = styled.div`
  width: 600px;
  margin: auto;
`

const Title = styled.h1`
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 8px;
  margin-top: -50px;
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

export default CodePage
