import { Alert, Button, Flex, Form, SegmentedControl, Switch, Tabs, TabsContent } from '@cherrystudio/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { loggerService } from '@logger'
import type { McpError } from '@modelcontextprotocol/sdk/types.js'
import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import DeleteIcon from '@renderer/components/icons/DeleteIcon'
import Scrollbar from '@renderer/components/Scrollbar'
import { SettingContainer, SettingDivider, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import { useMcpRuntimeStatus } from '@renderer/hooks/useMcpRuntimeStatus'
import { useMcpServer, useMcpServerMutations } from '@renderer/hooks/useMcpServer'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import McpDescription from '@renderer/pages/settings/McpSettings/McpDescription'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { McpTool } from '@renderer/types/tool'
import { formatMcpError } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import type { UpdateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { McpServer, McpServerType } from '@shared/data/types/mcpServer'
import type { McpPrompt, McpResource } from '@shared/types/mcp'
import { isInMemoryBuiltinMcpServer } from '@shared/utils/mcp'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ArrowLeft, SaveIcon } from 'lucide-react'
import React, { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import McpLogsTab from './McpLogsTab'
import McpPromptsSection from './McpPrompt'
import McpResourcesSection from './McpResource'
import {
  buildMcpSchema,
  McpEndpointField,
  McpFormGrid,
  type McpFormValues,
  McpIdentityFields,
  McpRuntimeFields,
  McpTransportFields,
  resolveMcpConfigInstallSource,
  toMcpFormDefaultValues,
  toMcpServerFields,
  useMcpRegistryState
} from './McpServerFields'
import McpToolsSection from './McpTool'
import { isQVerisApiKeyMissing, QVerisApiKeyGuide } from './QVerisApiKeyGuide'
import { useMcpServerTrust } from './useMcpServerTrust'
import { toUpdateMcpServerDto } from './utils'

const logger = loggerService.withContext('McpSettings')

type TabKey = 'settings' | 'description' | 'logs' | 'tools' | 'prompts' | 'resources'
type McpTabItem = {
  key: TabKey
  label: React.ReactNode
  children: React.ReactNode
}
type McpToolsCacheKey = `mcp.tools.${string}`
type McpSettingsSearch = { autoEnable?: 'true' }

const mcpToolsCacheKey = (serverId: string): McpToolsCacheKey => `mcp.tools.${serverId}`

// Module-level so the cache-miss fallback keeps a stable reference across renders.
const EMPTY_MCP_TOOLS: McpTool[] = []

interface McpSettingsContentProps {
  server: McpServer
  updateMcpServer: ReturnType<typeof useMcpServer>['updateMcpServer']
}

const McpSettingsContent: React.FC<McpSettingsContentProps> = ({ server, updateMcpServer }) => {
  const { t } = useTranslation()
  const search = useSearch({ strict: false }) as McpSettingsSearch
  const serverId = server.id
  const [initialFormValues] = useState(() => toMcpFormDefaultValues(server))

  const updateServerBody = useCallback((body: UpdateMcpServerDto) => updateMcpServer({ body }), [updateMcpServer])

  const { ensureServerTrusted } = useMcpServerTrust(updateServerBody)
  const [serverType, setServerType] = useState<McpServerType | undefined>(initialFormValues.serverType)
  const form = useForm<McpFormValues>({
    resolver: zodResolver(buildMcpSchema(t)) as any,
    defaultValues: initialFormValues
  })
  const [loading, setLoading] = useState(false)
  const [isFormChanged, setIsFormChanged] = useState(false)
  const [loadingServer, setLoadingServer] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('settings')
  const [toolSearchText, setToolSearchText] = useState('')
  const tools =
    useSharedCacheValue(serverId ? mcpToolsCacheKey(serverId) : mcpToolsCacheKey('__draft__')) ?? EMPTY_MCP_TOOLS
  const runtimeStatus = useMcpRuntimeStatus(server?.id, Boolean(server?.isActive))

  const [prompts, setPrompts] = useState<McpPrompt[]>([])
  const [resources, setResources] = useState<McpResource[]>([])
  const registryState = useMcpRegistryState(form, () => setIsFormChanged(true), server)

  const [serverVersion, setServerVersion] = useState<string | null>(null)
  const handledAutoEnableServerIdRef = useRef<string | null>(null)
  const loadedCapabilityTabsRef = useRef<{ serverId: string; tabs: Set<TabKey> } | null>(null)

  const { theme } = useTheme()

  const navigate = useNavigate()

  // Watch for serverType changes
  const watchedServerType = form.watch('serverType')
  useEffect(() => {
    if (watchedServerType) {
      setServerType(watchedServerType)
    }
  }, [watchedServerType])

  const markCapabilityLoaded = (tab: Extract<TabKey, 'tools' | 'prompts' | 'resources'>) => {
    if (loadedCapabilityTabsRef.current?.serverId !== server.id) {
      loadedCapabilityTabsRef.current = { serverId: server.id, tabs: new Set() }
    }
    loadedCapabilityTabsRef.current.tabs.add(tab)
  }

  const unmarkCapabilityLoaded = (tab: Extract<TabKey, 'tools' | 'prompts' | 'resources'>) => {
    if (loadedCapabilityTabsRef.current?.serverId !== server.id) return
    loadedCapabilityTabsRef.current.tabs.delete(tab)
  }

  const wasCapabilityLoaded = (tab: Extract<TabKey, 'tools' | 'prompts' | 'resources'>) =>
    loadedCapabilityTabsRef.current?.serverId === server.id && loadedCapabilityTabsRef.current.tabs.has(tab)

  const fetchTools = async () => {
    if (server?.isActive) {
      try {
        setLoadingServer(server.id)
        await ipcApi.request('mcp.server.refresh_tools', { serverId: server.id })
      } catch (error) {
        logger.error('Failed to list MCP tools', error as Error)
        unmarkCapabilityLoaded('tools')
      } finally {
        setLoadingServer(null)
      }
    }
  }

  const fetchPrompts = async () => {
    if (server?.isActive) {
      try {
        setLoadingServer(server.id)
        const localPrompts = await ipcApi.request('mcp.server.list_prompts', { serverId: server.id })
        setPrompts(localPrompts)
      } catch (error) {
        logger.error('Failed to list MCP prompts', error as Error)
        setPrompts([])
        unmarkCapabilityLoaded('prompts')
      } finally {
        setLoadingServer(null)
      }
    }
  }

  const fetchResources = async () => {
    if (server?.isActive) {
      try {
        setLoadingServer(server.id)
        const localResources = await ipcApi.request('mcp.server.list_resources', { serverId: server.id })
        setResources(localResources)
      } catch (error) {
        logger.error('Failed to list MCP resources', error as Error)
        setResources([])
        unmarkCapabilityLoaded('resources')
      } finally {
        setLoadingServer(null)
      }
    }
  }

  const fetchServerVersion = async () => {
    if (server?.isActive) {
      try {
        const version = await ipcApi.request('mcp.server.get_version', { serverId: server.id })
        setServerVersion(version)
      } catch (error) {
        logger.error('Failed to get MCP server version', error as Error)
        setServerVersion(null)
      }
    }
  }

  useEffect(() => {
    if (!server?.isActive) {
      setPrompts([])
      setResources([])
      setServerVersion(null)
      loadedCapabilityTabsRef.current = null
      return
    }

    void fetchServerVersion()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.id, server?.isActive])

  useEffect(() => {
    if (!server?.isActive) return
    if (activeTab !== 'tools' && activeTab !== 'prompts' && activeTab !== 'resources') return
    if (wasCapabilityLoaded(activeTab)) return

    markCapabilityLoaded(activeTab)
    if (activeTab === 'tools') void fetchTools()
    if (activeTab === 'prompts') void fetchPrompts()
    if (activeTab === 'resources') void fetchResources()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, server?.id, server?.isActive])

  // Save the form data
  const onSave = async () => {
    if (!server) return
    setLoading(true)
    try {
      const isValid = await form.trigger()
      if (!isValid) {
        setLoading(false)
        return
      }
      const values = form.getValues()

      const mcpServer: McpServer = {
        ...server,
        ...toMcpServerFields(values),
        installSource: resolveMcpConfigInstallSource(server),
        isActive: values.isActive ?? server.isActive,
        timeout: values.timeout || server.timeout,
        // Use nullish coalescing to allow empty strings (for deletion)
        provider: values.provider ?? server.provider,
        providerUrl: values.providerUrl ?? server.providerUrl,
        logoUrl: values.logoUrl ?? server.logoUrl,
        tags: values.tags ?? server.tags
      }

      const mcpServerDto = toUpdateMcpServerDto(mcpServer)

      if (server.isActive) {
        try {
          await updateMcpServer({ body: { ...mcpServerDto, isActive: true } })
          await ipcApi.request('mcp.server.restart', { serverId: server.id })
          toast.success(t('settings.mcp.updateSuccess'))
          setIsFormChanged(false)
        } catch (error: any) {
          void popup.error({
            title: t('settings.mcp.updateError'),
            content: error.message,
            centered: true
          })
        }
      } else {
        await updateMcpServer({ body: { ...mcpServerDto, isActive: false } })
        toast.success(t('settings.mcp.updateSuccess'))
        setIsFormChanged(false)
      }
      setLoading(false)
    } catch (error: any) {
      setLoading(false)
      logger.error('Failed to save MCP server settings:', error)
    }
  }

  const { removeMcpServer } = useMcpServerMutations(server.id)
  const onDeleteMcpServer = useCallback(async () => {
    try {
      const confirmed = await popup.confirm({
        title: t('settings.mcp.deleteServer'),
        content: t('settings.mcp.deleteServerConfirm'),
        centered: true,
        okButtonProps: { danger: true }
      })
      if (!confirmed) return

      await removeMcpServer()
      toast.success(t('settings.mcp.deleteSuccess'))
      void navigate({ to: '/settings/mcp' })
    } catch (error: any) {
      toast.error(`${t('settings.mcp.deleteError')}: ${error.message}`)
    }
  }, [removeMcpServer, t, navigate])

  const onToggleActive = async (active: boolean) => {
    if (!server) return
    if (isFormChanged && active) {
      await onSave()
      return
    }

    if (active && isQVerisApiKeyMissing(server)) {
      void popup.error({
        title: t('settings.mcp.startError'),
        content: <QVerisApiKeyGuide />,
        centered: true
      })
      return
    }

    const isValid = await form.trigger()
    if (!isValid) {
      return
    }

    let serverForUpdate = server
    if (active) {
      const trustedServer = await ensureServerTrusted(server)
      if (!trustedServer) {
        return
      }
      serverForUpdate = trustedServer
    }

    setLoadingServer(serverForUpdate.id)

    try {
      if (active) {
        await updateMcpServer({ body: { isActive: true } })
        try {
          await ipcApi.request('mcp.server.refresh_tools', { serverId: serverForUpdate.id })

          const localPrompts = await ipcApi.request('mcp.server.list_prompts', { serverId: serverForUpdate.id })
          setPrompts(localPrompts)

          const localResources = await ipcApi.request('mcp.server.list_resources', { serverId: serverForUpdate.id })
          setResources(localResources)

          const version = await ipcApi.request('mcp.server.get_version', { serverId: serverForUpdate.id })
          setServerVersion(version)

          markCapabilityLoaded('tools')
          markCapabilityLoaded('prompts')
          markCapabilityLoaded('resources')
        } catch (error: any) {
          void popup.error({
            title: t('settings.mcp.startError'),
            content: formatMcpError(error as McpError),
            centered: true
          })
        }
      } else {
        await updateMcpServer({ body: { isActive: false } })
        await ipcApi.request('mcp.server.stop', { serverId: serverForUpdate.id })
        setPrompts([])
        setResources([])
        setServerVersion(null)
        loadedCapabilityTabsRef.current = null
      }
      form.setValue('isActive', active)
    } catch (error: any) {
      void popup.error({
        title: active ? t('settings.mcp.startError') : t('settings.mcp.updateError'),
        content: formatMcpError(error as McpError),
        centered: true
      })
    } finally {
      setLoadingServer(null)
    }
  }

  const autoEnableProtocolServer = useEffectEvent(() => {
    if (server && !server.isActive) {
      void onToggleActive(true)
    }
  })

  useEffect(() => {
    if (search.autoEnable !== 'true' || !server) return
    if (handledAutoEnableServerIdRef.current === server.id) return

    handledAutoEnableServerIdRef.current = server.id
    void navigate({
      to: '/settings/mcp/settings/$serverId',
      params: { serverId: server.id },
      search: {},
      replace: true
    })

    autoEnableProtocolServer()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `useEffectEvent` reads the latest server and toggle handler without resubscribing.
  }, [navigate, search.autoEnable, server])

  // Handle toggling a tool on/off
  const handleToggleTool = useCallback(
    async (tool: McpTool, enabled: boolean) => {
      if (!server) return
      // Create a new disabledTools array or use the existing one
      let disabledTools = [...(server.disabledTools || [])]

      if (enabled) {
        // Remove tool from disabledTools if it's being enabled
        disabledTools = disabledTools.filter((name) => name !== tool.name)
      } else {
        // Add tool to disabledTools if it's being disabled
        if (!disabledTools.includes(tool.name)) {
          disabledTools.push(tool.name)
        }
      }

      // Save the updated server configuration
      void updateMcpServer({ body: { disabledTools } })
    },
    [server, updateMcpServer]
  )

  // Handle toggling auto-approve for a tool
  const handleToggleAutoApprove = useCallback(
    async (tool: McpTool, autoApprove: boolean) => {
      if (!server) return
      let disabledAutoApproveTools = [...(server.disabledAutoApproveTools || [])]

      if (autoApprove) {
        disabledAutoApproveTools = disabledAutoApproveTools.filter((name) => name !== tool.name)
      } else {
        // Add tool to disabledTools if it's being disabled
        if (!disabledAutoApproveTools.includes(tool.name)) {
          disabledAutoApproveTools.push(tool.name)
        }
      }

      // Save the updated server configuration
      void updateMcpServer({ body: { disabledAutoApproveTools } })
    },
    [server, updateMcpServer]
  )

  const runtimeError = server.isActive && runtimeStatus.state === 'error' ? runtimeStatus.lastError : undefined
  const runtimeStatusLabel = {
    disabled: t('settings.mcp.runtimeStatus.disabled', 'Disabled'),
    connecting: t('settings.mcp.runtimeStatus.connecting', 'Connecting'),
    connected: t('settings.mcp.runtimeStatus.connected', 'Connected'),
    error: t('settings.mcp.runtimeStatus.error', 'Error')
  }[server.isActive ? runtimeStatus.state : 'disabled']
  const focusRuntimeErrorField = () =>
    form.setFocus(
      isQVerisApiKeyMissing(server)
        ? 'env'
        : serverType === 'stdio'
          ? 'command'
          : serverType === 'inMemory'
            ? 'env'
            : 'baseUrl'
    )

  const fieldsProps = {
    form,
    serverType,
    onServerTypeChange: setServerType,
    registryState,
    isBuiltin: server.installSource === 'builtin' || isInMemoryBuiltinMcpServer(server),
    builtinRequiresEnv:
      (server.installSource === 'builtin' || isInMemoryBuiltinMcpServer(server)) && Boolean(server.shouldConfig)
  }

  const tabs: McpTabItem[] = [
    {
      key: 'settings',
      label: t('settings.mcp.tabs.general'),
      children: (
        <Form {...form}>
          <form
            onChange={() => setIsFormChanged(true)}
            className="flex w-full min-w-0 flex-col gap-4 pb-6 [&_[data-slot=select-trigger]]:bg-background [&_input[data-slot=form-control]]:bg-background [&_textarea[data-slot=form-control]]:bg-background"
            id="mcp-settings-form">
            {runtimeError && (
              <Alert
                type="error"
                showIcon
                message={t('settings.mcp.runtimeStatus.unavailable', 'Server unavailable')}
                description={
                  <div className="space-y-1">
                    <div>{runtimeStatus.errorCode ? `${runtimeStatus.errorCode}: ${runtimeError}` : runtimeError}</div>
                    {runtimeStatus.errorPath && (
                      <code className="block break-all text-xs">{runtimeStatus.errorPath}</code>
                    )}
                  </div>
                }
                action={
                  <Button type="button" variant="outline" size="sm" onClick={focusRuntimeErrorField}>
                    {t('common.edit')}
                  </Button>
                }
                className="shadow-none"
              />
            )}
            <McpFormSection>
              <McpIdentityFields {...fieldsProps} />
            </McpFormSection>

            <McpFormSection>
              <McpFormGrid>
                <McpEndpointField {...fieldsProps} />
                <McpTransportFields {...fieldsProps} />
              </McpFormGrid>
            </McpFormSection>

            <McpFormSection>
              <McpRuntimeFields {...fieldsProps} />
            </McpFormSection>
          </form>
        </Form>
      )
    }
  ]

  if (server.searchKey) {
    tabs.push({
      key: 'description',
      label: t('settings.mcp.tabs.description'),
      children: <McpDescription searchKey={server.searchKey} />
    })
  }

  if (server.isActive) {
    tabs.push({
      key: 'tools',
      label: t('settings.mcp.tabs.tools') + (tools.length > 0 ? ` (${tools.length})` : ''),
      children: (
        <>
          {runtimeError && tools.length === 0 ? (
            <Alert
              type="error"
              showIcon
              message={t('settings.mcp.runtimeStatus.unavailable', 'Server unavailable')}
              description={runtimeError}
            />
          ) : (
            <McpToolsSection
              tools={tools}
              server={server}
              searchText={toolSearchText}
              onToggleTool={handleToggleTool}
              onToggleAutoApprove={handleToggleAutoApprove}
            />
          )}
        </>
      )
    })

    tabs.push(
      {
        key: 'prompts',
        label: t('settings.mcp.tabs.prompts') + (prompts.length > 0 ? ` (${prompts.length})` : ''),
        children: <McpPromptsSection prompts={prompts} />
      },
      {
        key: 'resources',
        label: t('settings.mcp.tabs.resources') + (resources.length > 0 ? ` (${resources.length})` : ''),
        children: <McpResourcesSection resources={resources} />
      }
    )
  }

  tabs.push({
    key: 'logs',
    label: t('settings.mcp.logs', 'Logs'),
    children: activeTab === 'logs' ? <McpLogsTab serverId={server.id} /> : null
  })

  const activeTabValue = tabs.some((tab) => tab.key === activeTab) ? activeTab : 'settings'

  return (
    <Container>
      <SettingContainer
        theme={theme}
        className="min-w-0 overflow-hidden p-0"
        style={{ width: '100%', backgroundColor: 'transparent' }}>
        <Tabs
          value={activeTabValue}
          onValueChange={(value) => setActiveTab(value as TabKey)}
          variant="line"
          className="flex min-h-0 flex-1 flex-col bg-transparent">
          <div className="shrink-0 px-6 pt-2">
            <div className="mx-auto w-full max-w-3xl">
              <SettingTitle className="min-w-0 flex-wrap gap-2">
                <Flex className="min-w-0 flex-1 flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="-ml-2 shrink-0 rounded-full"
                    aria-label={t('common.back')}
                    title={t('common.back')}
                    onClick={() => void navigate({ to: '/settings/mcp/servers' })}>
                    <ArrowLeft size={16} />
                  </Button>
                  <Flex className="min-w-0 flex-1 items-center gap-2">
                    <ServerName className="truncate">{server?.name}</ServerName>
                    <McpRuntimeStatusBadge state={server.isActive ? runtimeStatus.state : 'disabled'}>
                      {runtimeStatusLabel}
                    </McpRuntimeStatusBadge>
                    {serverVersion && <VersionText>{serverVersion}</VersionText>}
                  </Flex>
                </Flex>
                <Flex className="shrink-0 items-center">
                  <Switch
                    checked={server.isActive}
                    key={server.id}
                    loading={loadingServer === server.id}
                    onCheckedChange={onToggleActive}
                  />
                </Flex>
              </SettingTitle>
              <SettingDivider className="mb-0" />
              <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                <SegmentedControl<TabKey>
                  value={activeTabValue}
                  options={tabs.map((tab) => ({ value: tab.key, label: tab.label }))}
                  onValueChange={setActiveTab}
                  size="sm"
                  className="min-w-0 max-w-full overflow-x-auto border-0 bg-muted/60"
                  aria-label={t('settings.mcp.title')}
                />
                {activeTabValue === 'tools' && tools.length > 0 && (
                  <div className="flex h-7 shrink-0 items-center">
                    <CollapsibleSearchBar
                      onSearch={setToolSearchText}
                      placeholder={t('common.search')}
                      tooltip={t('common.search')}
                      maxWidth={220}
                      collapsedSize={28}
                      style={{ borderRadius: 14 }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
          <Scrollbar className="min-h-0 flex-1 px-6 pt-2 pb-6">
            <div className="mx-auto w-full max-w-3xl">
              {tabs.map((tab) => (
                <TabsContent key={tab.key} value={tab.key} className="mt-0 min-h-0">
                  {tab.children}
                </TabsContent>
              ))}
            </div>
          </Scrollbar>
          {activeTabValue === 'settings' && (
            <div className="flex min-h-14 shrink-0 items-center border-border-subtle border-t px-6">
              <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void onDeleteMcpServer()}
                  className="-ml-2 -mt-1 hover:!bg-destructive hover:!text-destructive-foreground rounded-full text-destructive opacity-60 hover:opacity-100 focus-visible:opacity-100 active:opacity-100">
                  <DeleteIcon size={14} className="lucide-custom" />
                  {t('common.delete')}
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  onClick={onSave}
                  disabled={loading || !isFormChanged}
                  className="rounded-full">
                  <SaveIcon size={14} />
                  {t('common.save')}
                </Button>
              </div>
            </div>
          )}
        </Tabs>
      </SettingContainer>
    </Container>
  )
}

const McpSettings: React.FC = () => {
  const params = useParams({ strict: false })
  const serverId = params.serverId
  const { server, isLoading, updateMcpServer } = useMcpServer(serverId ?? '')

  if (!server || isLoading) {
    return null
  }

  return <McpSettingsContent key={server.id} server={server} updateMcpServer={updateMcpServer} />
}

const Container = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex h-full w-full min-w-0 flex-1 flex-col overflow-hidden', className)} {...props} />
)

const ServerName = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('block min-w-0 text-sm', className)} {...props} />
)

const McpFormSection = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={className} {...props} />
)

const VersionText = ({ className, ...props }: React.ComponentProps<'span'>) => (
  <span className={cn('shrink-0 text-[11px] text-muted-foreground leading-4', className)} {...props} />
)

const McpRuntimeStatusBadge = ({
  state,
  className,
  ...props
}: { state: 'disabled' | 'connecting' | 'connected' | 'error' } & React.ComponentProps<'span'>) => (
  <span
    className={cn(
      'inline-flex h-4.5 items-center rounded-[9px] px-1.5 text-[11px] leading-4.5',
      state === 'connected' && 'border border-success-border bg-success-subtle text-success-subtle-foreground',
      state === 'connecting' && 'border border-warning-border bg-warning-subtle text-warning-subtle-foreground',
      state === 'error' && 'border border-error-border bg-error-subtle text-error-subtle-foreground',
      state === 'disabled' && 'bg-muted text-muted-foreground',
      className
    )}
    {...props}
  />
)

export default McpSettings
