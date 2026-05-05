import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Flex,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  InfoTooltip,
  Input,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea
} from '@cherrystudio/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { loggerService } from '@logger'
import type { McpError } from '@modelcontextprotocol/sdk/types.js'
import { DeleteIcon } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMCPServer } from '@renderer/hooks/useMCPServers'
import { useMCPServerTrust } from '@renderer/hooks/useMCPServerTrust'
import MCPDescription from '@renderer/pages/settings/MCPSettings/McpDescription'
import type { MCPPrompt, MCPResource, MCPTool } from '@renderer/types'
import { parseKeyValueString } from '@renderer/utils/env'
import { formatMcpError } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import type { MCPServerLogEntry } from '@shared/config/types'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { useNavigate, useParams } from '@tanstack/react-router'
import { ChevronDown, SaveIcon, X } from 'lucide-react'
import React, { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { SettingContainer, SettingDivider, SettingTitle } from '..'
import MCPPromptsSection from './McpPrompt'
import MCPResourcesSection from './McpResource'
import MCPToolsSection from './McpTool'

const logger = loggerService.withContext('McpSettings')

const buildMcpSchema = (t: (key: string) => string) =>
  z
    .object({
      name: z.string().min(1, t('common.name')),
      description: z.string().optional(),
      serverType: z.enum(['stdio', 'sse', 'streamableHttp', 'inMemory']),
      baseUrl: z.string().optional(),
      command: z.string().optional(),
      registryUrl: z.string().optional(),
      args: z.string().optional(),
      env: z.string().optional(),
      isActive: z.boolean().optional(),
      headers: z.string().optional(),
      longRunning: z.boolean().optional(),
      timeout: z.coerce.number().optional(),
      provider: z.string().optional(),
      providerUrl: z.string().optional(),
      logoUrl: z.string().optional(),
      tags: z.array(z.string()).optional()
    })
    .superRefine((value, ctx) => {
      if ((value.serverType === 'sse' || value.serverType === 'streamableHttp') && !value.baseUrl?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['baseUrl'], message: t('settings.mcp.url') })
      }
      if (value.serverType === 'stdio' && !value.command?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['command'], message: t('settings.mcp.command') })
      }
    })

type MCPFormValues = z.infer<ReturnType<typeof buildMcpSchema>>

interface Registry {
  name: string
  url: string
}

const NpmRegistry: Registry[] = [
  { name: '淘宝 NPM Mirror', url: 'https://registry.npmmirror.com' },
  { name: '自定义', url: 'custom' }
]
const PipRegistry: Registry[] = [
  { name: '清华大学', url: 'https://pypi.tuna.tsinghua.edu.cn/simple' },
  { name: '阿里云', url: 'http://mirrors.aliyun.com/pypi/simple/' },
  { name: '中国科学技术大学', url: 'https://mirrors.ustc.edu.cn/pypi/simple/' },
  { name: '华为云', url: 'https://repo.huaweicloud.com/repository/pypi/simple/' },
  { name: '腾讯云', url: 'https://mirrors.cloud.tencent.com/pypi/simple/' }
]

type TabKey = 'settings' | 'description' | 'tools' | 'prompts' | 'resources'
type McpTabItem = {
  key: TabKey
  label: React.ReactNode
  children: React.ReactNode
}

const McpSettings: React.FC = () => {
  const { t } = useTranslation()
  const params = useParams({ strict: false })
  const serverId = params.serverId
  const { server, isLoading: isServerLoading, updateMCPServer, deleteMCPServer } = useMCPServer(serverId ?? '')

  const updateServerBody = useCallback((body: Partial<MCPServer>) => updateMCPServer({ body }), [updateMCPServer])

  const { ensureServerTrusted } = useMCPServerTrust(updateServerBody)
  const [serverType, setServerType] = useState<MCPServer['type']>('stdio')
  const form = useForm<MCPFormValues>({
    resolver: zodResolver(buildMcpSchema(t)) as any,
    defaultValues: {
      name: '',
      description: '',
      serverType: 'stdio',
      baseUrl: '',
      command: '',
      registryUrl: '',
      args: '',
      env: '',
      isActive: false,
      headers: '',
      longRunning: false,
      timeout: undefined,
      provider: '',
      providerUrl: '',
      logoUrl: '',
      tags: []
    }
  })
  const [loading, setLoading] = useState(false)
  const [isFormChanged, setIsFormChanged] = useState(false)
  const [loadingServer, setLoadingServer] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('settings')

  const [tools, setTools] = useState<MCPTool[]>([])
  const [prompts, setPrompts] = useState<MCPPrompt[]>([])
  const [resources, setResources] = useState<MCPResource[]>([])
  const [isShowRegistry, setIsShowRegistry] = useState(false)
  const [registry, setRegistry] = useState<Registry[]>()
  const [customRegistryUrl, setCustomRegistryUrl] = useState('')
  const [selectedRegistryType, setSelectedRegistryType] = useState<string>('')

  const [showAdvanced, setShowAdvanced] = useState(false)
  const [serverVersion, setServerVersion] = useState<string | null>(null)
  const [logModalOpen, setLogModalOpen] = useState(false)
  const [logs, setLogs] = useState<(MCPServerLogEntry & { serverId?: string })[]>([])

  const { theme } = useTheme()

  const navigate = useNavigate()

  // Initialize form values whenever the server changes
  useEffect(() => {
    if (!server) return
    const serverType: MCPServer['type'] = server.type || (server.baseUrl ? 'sse' : 'stdio')
    setServerType(serverType)

    // Set registry UI state based on command and registryUrl
    if (server.command) {
      handleCommandChange(server.command)

      // If there's a registryUrl, ensure registry UI is shown
      if (server.registryUrl) {
        setIsShowRegistry(true)

        // Determine registry type based on command
        let currentRegistry: Registry[] = []
        if (server.command.includes('uv') || server.command.includes('uvx')) {
          currentRegistry = PipRegistry
          setRegistry(PipRegistry)
        } else if (
          server.command.includes('npx') ||
          server.command.includes('bun') ||
          server.command.includes('bunx')
        ) {
          currentRegistry = NpmRegistry
          setRegistry(NpmRegistry)
        }

        // Check if the registryUrl is a custom URL (not in the predefined list)
        const isCustomRegistry =
          currentRegistry.length > 0 &&
          !currentRegistry.some((reg) => reg.url === server.registryUrl) &&
          server.registryUrl !== '' // empty string is default

        if (isCustomRegistry) {
          // Set custom registry state
          setSelectedRegistryType('custom')
          setCustomRegistryUrl(server.registryUrl)
        } else {
          // Reset custom registry state for predefined registries
          setSelectedRegistryType('')
          setCustomRegistryUrl('')
        }
      }
    }

    // Initialize all fields
    form.reset({
      name: server.name,
      description: server.description ?? '',
      serverType: serverType,
      baseUrl: server.baseUrl || '',
      command: server.command || '',
      registryUrl: server.registryUrl || '',
      isActive: server.isActive,
      longRunning: server.longRunning,
      timeout: server.timeout,
      args: server.args ? server.args.join('\n') : '',
      env: server.env
        ? Object.entries(server.env)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n')
        : '',
      headers: server.headers
        ? Object.entries(server.headers)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n')
        : '',
      provider: server.provider || '',
      providerUrl: server.providerUrl || '',
      logoUrl: server.logoUrl || '',
      tags: server.tags || []
    })
  }, [server, form])

  // Watch for serverType changes
  const watchedServerType = form.watch('serverType')
  useEffect(() => {
    if (watchedServerType) {
      setServerType(watchedServerType)
    }
  }, [watchedServerType])

  const fetchTools = async () => {
    if (server?.isActive) {
      try {
        setLoadingServer(server.id)
        const localTools = await window.api.mcp.listTools(server)
        setTools(localTools)
      } catch (error) {
        setLoadingServer(server.id)
      } finally {
        setLoadingServer(null)
      }
    }
  }

  const fetchPrompts = async () => {
    if (server?.isActive) {
      try {
        setLoadingServer(server.id)
        const localPrompts = await window.api.mcp.listPrompts(server)
        setPrompts(localPrompts)
      } catch (error) {
        setPrompts([])
      } finally {
        setLoadingServer(null)
      }
    }
  }

  const fetchResources = async () => {
    if (server?.isActive) {
      try {
        setLoadingServer(server.id)
        const localResources = await window.api.mcp.listResources(server)
        setResources(localResources)
      } catch (error) {
        setResources([])
      } finally {
        setLoadingServer(null)
      }
    }
  }

  const fetchServerVersion = async () => {
    if (server?.isActive) {
      try {
        const version = await window.api.mcp.getServerVersion(server)
        setServerVersion(version)
      } catch (error) {
        setServerVersion(null)
      }
    }
  }

  const fetchServerLogs = async () => {
    if (!server) return
    try {
      const history = await window.api.mcp.getServerLogs(server)
      setLogs(history)
    } catch (error) {
      logger.warn('Failed to load server logs', error as Error)
    }
  }

  useEffect(() => {
    const unsubscribe = window.api.mcp.onServerLog((log) => {
      if (log.serverId && log.serverId !== server?.id) return
      setLogs((prev) => {
        const merged = [...prev, log]
        if (merged.length > 200) {
          return merged.slice(merged.length - 200)
        }
        return merged
      })
    })

    return () => {
      unsubscribe?.()
    }
  }, [server?.id])

  useEffect(() => {
    setLogs([])
  }, [server?.id])

  useEffect(() => {
    if (server?.isActive) {
      void fetchTools()
      void fetchPrompts()
      void fetchResources()
      void fetchServerVersion()
      void fetchServerLogs()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.id, server?.isActive])

  useEffect(() => {
    setIsFormChanged(false)
  }, [server?.id])

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

      // set basic fields
      const mcpServer: MCPServer = {
        ...server,
        id: server.id,
        name: values.name,
        type: values.serverType || server.type,
        description: values.description,
        isActive: values.isActive ?? server.isActive,
        registryUrl: values.registryUrl,
        searchKey: server.searchKey,
        timeout: values.timeout || server.timeout,
        longRunning: values.longRunning,
        // Use nullish coalescing to allow empty strings (for deletion)
        provider: values.provider ?? server.provider,
        providerUrl: values.providerUrl ?? server.providerUrl,
        logoUrl: values.logoUrl ?? server.logoUrl,
        tags: values.tags ?? server.tags
      }

      // set stdio or sse server
      if (values.serverType === 'sse' || values.serverType === 'streamableHttp') {
        mcpServer.baseUrl = values.baseUrl
      } else {
        mcpServer.command = values.command
        mcpServer.args = values.args ? values.args.split('\n').filter((arg) => arg.trim() !== '') : []
      }

      // set env variables
      if (values.env) {
        mcpServer.env = parseKeyValueString(values.env)
      }

      if (values.headers) {
        mcpServer.headers = parseKeyValueString(values.headers)
      }

      if (server.isActive) {
        try {
          await window.api.mcp.restartServer(mcpServer)
          await updateMCPServer({ body: { ...mcpServer, isActive: true } })
          window.toast.success(t('settings.mcp.updateSuccess'))
          setIsFormChanged(false)
        } catch (error: any) {
          await updateMCPServer({ body: { ...mcpServer, isActive: false } }).catch(() => {})
          window.modal.error({
            title: t('settings.mcp.updateError'),
            content: error.message,
            centered: true
          })
        }
      } else {
        await updateMCPServer({ body: { ...mcpServer, isActive: false } })
        window.toast.success(t('settings.mcp.updateSuccess'))
        setIsFormChanged(false)
      }
      setLoading(false)
    } catch (error: any) {
      setLoading(false)
      logger.error('Failed to save MCP server settings:', error)
    }
  }

  // Watch for command field changes
  const handleCommandChange = (command: string) => {
    if (command.includes('uv') || command.includes('uvx')) {
      setIsShowRegistry(true)
      setRegistry(PipRegistry)
    } else if (command.includes('npx') || command.includes('bun') || command.includes('bunx')) {
      setIsShowRegistry(true)
      setRegistry(NpmRegistry)
    } else {
      setIsShowRegistry(false)
      setRegistry(undefined)
    }
  }

  const onSelectRegistry = (url: string) => {
    const command = form.getValues('command') || ''

    // If custom registry is selected
    if (url === 'custom') {
      setSelectedRegistryType('custom')
      // Don't set the registryUrl yet, wait for user input
      return
    }

    setSelectedRegistryType('')
    setCustomRegistryUrl('')

    // Add new registry env variables
    if (command.includes('uv') || command.includes('uvx')) {
      form.setValue('registryUrl', url)
    } else if (command.includes('npx') || command.includes('bun') || command.includes('bunx')) {
      form.setValue('registryUrl', url)
    }

    // Mark form as changed
    setIsFormChanged(true)
  }

  const onCustomRegistryChange = (url: string) => {
    setCustomRegistryUrl(url)
    form.setValue('registryUrl', url)
    setIsFormChanged(true)
  }

  const onDeleteMcpServer = useCallback(
    async (serverToDelete: MCPServer) => {
      try {
        window.modal.confirm({
          title: t('settings.mcp.deleteServer'),
          content: t('settings.mcp.deleteServerConfirm'),
          centered: true,
          onOk: async () => {
            await window.api.mcp.removeServer(serverToDelete)
            await deleteMCPServer({})
            window.toast.success(t('settings.mcp.deleteSuccess'))
            void navigate({ to: '/settings/mcp' })
          }
        })
      } catch (error: any) {
        window.toast.error(`${t('settings.mcp.deleteError')}: ${error.message}`)
      }
    },

    [deleteMCPServer, t, navigate]
  )

  const onToggleActive = async (active: boolean) => {
    if (!server) return
    if (isFormChanged && active) {
      await onSave()
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
    const oldActiveState = serverForUpdate.isActive

    try {
      if (active) {
        const localTools = await window.api.mcp.listTools(serverForUpdate)
        setTools(localTools)

        const localPrompts = await window.api.mcp.listPrompts(serverForUpdate)
        setPrompts(localPrompts)

        const localResources = await window.api.mcp.listResources(serverForUpdate)
        setResources(localResources)

        const version = await window.api.mcp.getServerVersion(serverForUpdate)
        setServerVersion(version)
      } else {
        await window.api.mcp.stopServer(serverForUpdate)
        setServerVersion(null)
      }
      void updateMCPServer({ body: { isActive: active } })
    } catch (error: any) {
      window.modal.error({
        title: t('settings.mcp.startError'),
        content: formatMcpError(error as McpError),
        centered: true
      })
      void updateMCPServer({ body: { isActive: oldActiveState } })
    } finally {
      setLoadingServer(null)
    }
  }

  // Handle toggling a tool on/off
  const handleToggleTool = useCallback(
    async (tool: MCPTool, enabled: boolean) => {
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
      void updateMCPServer({ body: { disabledTools } })
    },
    [server, updateMCPServer]
  )

  // Handle toggling auto-approve for a tool
  const handleToggleAutoApprove = useCallback(
    async (tool: MCPTool, autoApprove: boolean) => {
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
      void updateMCPServer({ body: { disabledAutoApproveTools } })
    },
    [server, updateMCPServer]
  )

  if (!server || isServerLoading) {
    return null
  }

  const tabs: McpTabItem[] = [
    {
      key: 'settings',
      label: t('settings.mcp.tabs.general'),
      children: (
        <Form {...form}>
          <form
            onChange={() => setIsFormChanged(true)}
            className="mx-auto flex w-full min-w-0 max-w-[920px] flex-col gap-5 pb-6"
            id="mcp-settings-form">
            <McpFormSection>
              <McpFormGrid>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>{t('settings.mcp.name')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('common.name')} disabled={server.type === 'inMemory'} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {server.type !== 'inMemory' && (
                  <FormField
                    control={form.control}
                    name="serverType"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel>{t('settings.mcp.type')}</FormLabel>
                        <FormControl>
                          <Select
                            value={field.value}
                            onValueChange={(value) => {
                              field.onChange(value)
                              setServerType(value as MCPServer['type'])
                            }}>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="stdio">{t('settings.mcp.stdio')}</SelectItem>
                              <SelectItem value="sse">{t('settings.mcp.sse')}</SelectItem>
                              <SelectItem value="streamableHttp">{t('settings.mcp.streamableHttp')}</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem className="min-w-0 xl:col-span-2">
                      <FormLabel>{t('settings.mcp.description')}</FormLabel>
                      <FormControl>
                        <Textarea.Input
                          rows={2}
                          placeholder={t('common.description')}
                          className="min-h-[64px] px-3 py-2 text-sm leading-5"
                          {...field}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </McpFormGrid>
            </McpFormSection>

            <McpFormSection>
              {(serverType === 'sse' || serverType === 'streamableHttp') && (
                <McpFormGrid>
                  <FormField
                    control={form.control}
                    name="baseUrl"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel className="flex items-center gap-1">
                          {t('settings.mcp.url')}
                          <InfoTooltip content={t('settings.mcp.baseUrlTooltip')} />
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder={
                              serverType === 'sse' ? 'http://localhost:3000/sse' : 'http://localhost:3000/mcp'
                            }
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="headers"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel className="flex items-center gap-1">
                          {t('settings.mcp.headers')}
                          <InfoTooltip content={t('settings.mcp.headersTooltip')} />
                        </FormLabel>
                        <FormControl>
                          <Textarea.Input
                            rows={3}
                            placeholder={`Content-Type=application/json\nAuthorization=Bearer token`}
                            className="max-h-[160px] min-h-[84px] px-3 py-2 font-mono text-sm leading-5"
                            {...field}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </McpFormGrid>
              )}
              {serverType === 'stdio' && (
                <McpFormGrid>
                  <FormField
                    control={form.control}
                    name="command"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel>{t('settings.mcp.command')}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="uvx or npx"
                            {...field}
                            onChange={(e) => {
                              field.onChange(e)
                              handleCommandChange(e.target.value)
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {isShowRegistry && registry && (
                    <FormField
                      control={form.control}
                      name="registryUrl"
                      render={({ field }) => (
                        <FormItem className="min-w-0">
                          <FormLabel className="flex items-center gap-1">
                            {t('settings.mcp.registry')}
                            <InfoTooltip content={t('settings.mcp.registryTooltip')} />
                          </FormLabel>
                          <FormControl>
                            <RadioGroup
                              value={selectedRegistryType === 'custom' ? 'custom' : field.value || ''}
                              onValueChange={onSelectRegistry}
                              className="flex flex-row flex-wrap gap-x-4 gap-y-2">
                              <label className="flex items-center gap-2 text-sm">
                                <RadioGroupItem value="" />
                                {t('settings.mcp.registryDefault')}
                              </label>
                              {registry.map((reg) => (
                                <label key={reg.url} className="flex items-center gap-2 text-sm">
                                  <RadioGroupItem value={reg.url} />
                                  {reg.name}
                                </label>
                              ))}
                            </RadioGroup>
                          </FormControl>
                          {selectedRegistryType === 'custom' && (
                            <Input
                              className="mt-2"
                              placeholder={t(
                                'settings.mcp.customRegistryPlaceholder',
                                '请输入私有仓库地址，如: https://npm.company.com'
                              )}
                              value={customRegistryUrl}
                              onChange={(e) => onCustomRegistryChange(e.target.value)}
                            />
                          )}
                        </FormItem>
                      )}
                    />
                  )}
                  <FormField
                    control={form.control}
                    name="args"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel className="flex items-center gap-1">
                          {t('settings.mcp.args')}
                          <InfoTooltip content={t('settings.mcp.argsTooltip')} />
                        </FormLabel>
                        <FormControl>
                          <Textarea.Input
                            rows={3}
                            placeholder={`arg1\narg2`}
                            className="max-h-[160px] min-h-[84px] px-3 py-2 font-mono text-sm leading-5"
                            {...field}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="env"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel className="flex items-center gap-1">
                          {t('settings.mcp.env')}
                          <InfoTooltip content={t('settings.mcp.envTooltip')} />
                        </FormLabel>
                        <FormControl>
                          <Textarea.Input
                            rows={3}
                            placeholder={`KEY1=value1\nKEY2=value2`}
                            className="max-h-[160px] min-h-[84px] px-3 py-2 font-mono text-sm leading-5"
                            {...field}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </McpFormGrid>
              )}
              {serverType === 'inMemory' && (
                <McpFormGrid>
                  <FormField
                    control={form.control}
                    name="args"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel className="flex items-center gap-1">
                          {t('settings.mcp.args')}
                          <InfoTooltip content={t('settings.mcp.argsTooltip')} />
                        </FormLabel>
                        <FormControl>
                          <Textarea.Input
                            rows={3}
                            placeholder={`arg1\narg2`}
                            className="max-h-[160px] min-h-[84px] px-3 py-2 font-mono text-sm leading-5"
                            {...field}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="env"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel className="flex items-center gap-1">
                          {t('settings.mcp.env')}
                          <InfoTooltip content={t('settings.mcp.envTooltip')} />
                        </FormLabel>
                        <FormControl>
                          <Textarea.Input
                            rows={3}
                            placeholder={`KEY1=value1\nKEY2=value2`}
                            className="max-h-[160px] min-h-[84px] px-3 py-2 font-mono text-sm leading-5"
                            {...field}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </McpFormGrid>
              )}
            </McpFormSection>

            <McpFormSection>
              <McpFormGrid>
                <FormField
                  control={form.control}
                  name="longRunning"
                  render={({ field }) => (
                    <FormItem className={mcpInlineSettingItemClassName}>
                      <FormLabel className="flex items-center gap-1">
                        {t('settings.mcp.longRunning', 'Long Running')}
                        <InfoTooltip content={t('settings.mcp.longRunningTooltip')} />
                      </FormLabel>
                      <FormControl>
                        <Switch size="sm" checked={!!field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="timeout"
                  render={({ field }) => (
                    <FormItem className={mcpInlineSettingItemClassName}>
                      <FormLabel className="flex items-center gap-1">
                        {t('settings.mcp.timeout', 'Timeout')}
                        <InfoTooltip
                          content={t(
                            'settings.mcp.timeoutTooltip',
                            'Timeout in seconds for requests to this server, default is 60 seconds'
                          )}
                        />
                      </FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            placeholder="60"
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                            className="h-8 w-24 py-0"
                          />
                          <span className="text-foreground-muted text-xs">s</span>
                        </div>
                      </FormControl>
                    </FormItem>
                  )}
                />
              </McpFormGrid>
            </McpFormSection>

            <AdvancedSettingsButton onClick={() => setShowAdvanced(!showAdvanced)}>
              <ChevronDown
                size={16}
                className={cn('transition-transform duration-200', showAdvanced && 'rotate-180')}
              />
              {t('common.advanced_settings')}
            </AdvancedSettingsButton>

            {showAdvanced && (
              <McpFormSection>
                <McpFormGrid>
                  <FormField
                    control={form.control}
                    name="provider"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel>{t('settings.mcp.provider', 'Provider')}</FormLabel>
                        <FormControl>
                          <Input placeholder={t('settings.mcp.providerPlaceholder', 'Provider name')} {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="providerUrl"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel>{t('settings.mcp.providerUrl', 'Provider URL')}</FormLabel>
                        <FormControl>
                          <Input placeholder="https://provider-website.com" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="logoUrl"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel>{t('settings.mcp.logoUrl', 'Logo URL')}</FormLabel>
                        <FormControl>
                          <Input placeholder="https://example.com/logo.png" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="tags"
                    render={({ field }) => (
                      <FormItem className="min-w-0 xl:col-span-2">
                        <FormLabel>{t('settings.mcp.tags', 'Tags')}</FormLabel>
                        <FormControl>
                          <TagsInput
                            value={field.value ?? []}
                            onChange={(next) => {
                              field.onChange(next)
                              setIsFormChanged(true)
                            }}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </McpFormGrid>
              </McpFormSection>
            )}
          </form>
        </Form>
      )
    }
  ]

  if (server.searchKey) {
    tabs.push({
      key: 'description',
      label: t('settings.mcp.tabs.description'),
      children: <MCPDescription searchKey={server.searchKey} />
    })
  }

  if (server.isActive) {
    tabs.push(
      {
        key: 'tools',
        label: t('settings.mcp.tabs.tools') + (tools.length > 0 ? ` (${tools.length})` : ''),
        children: (
          <MCPToolsSection
            tools={tools}
            server={server}
            onToggleTool={handleToggleTool}
            onToggleAutoApprove={handleToggleAutoApprove}
          />
        )
      },
      {
        key: 'prompts',
        label: t('settings.mcp.tabs.prompts') + (prompts.length > 0 ? ` (${prompts.length})` : ''),
        children: <MCPPromptsSection prompts={prompts} />
      },
      {
        key: 'resources',
        label: t('settings.mcp.tabs.resources') + (resources.length > 0 ? ` (${resources.length})` : ''),
        children: <MCPResourcesSection resources={resources} />
      }
    )
  }

  const activeTabValue = tabs.some((tab) => tab.key === activeTab) ? activeTab : 'settings'

  return (
    <Container>
      <SettingContainer
        theme={theme}
        className="min-w-0"
        style={{ width: '100%', paddingTop: 55, backgroundColor: 'transparent' }}>
        <div className="min-h-0 min-w-0">
          <SettingTitle className="min-w-0 flex-wrap gap-2">
            <Flex className="min-w-0 flex-1 flex-wrap items-center gap-2">
              <Flex className="min-w-0 flex-1 items-center gap-2">
                <ServerName className="truncate">{server?.name}</ServerName>
                {serverVersion && <VersionBadge count={serverVersion} color="blue" />}
              </Flex>
              <Button size="sm" variant="ghost" onClick={() => setLogModalOpen(true)}>
                {t('settings.mcp.logs', 'View Logs')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDeleteMcpServer(server)}>
                <DeleteIcon size={14} className="lucide-custom text-destructive" />
              </Button>
            </Flex>
            <Flex className="shrink-0 items-center gap-3">
              <Switch
                checked={server.isActive}
                key={server.id}
                loading={loadingServer === server.id}
                onCheckedChange={onToggleActive}
              />
              <Button
                size="sm"
                variant="default"
                onClick={onSave}
                disabled={loading || !isFormChanged || activeTabValue !== 'settings'}
                className="rounded-full">
                <SaveIcon size={14} />
                {t('common.save')}
              </Button>
            </Flex>
          </SettingTitle>
          <SettingDivider />
          <Tabs
            value={activeTabValue}
            onValueChange={(value) => setActiveTab(value as TabKey)}
            variant="line"
            className="mt-2 min-w-0 bg-transparent">
            <TabsList className="max-w-full overflow-x-auto">
              {tabs.map((tab) => (
                <TabsTrigger key={tab.key} value={tab.key}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {tabs.map((tab) => (
              <TabsContent key={tab.key} value={tab.key} className="mt-2 min-h-0">
                {tab.children}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </SettingContainer>

      <Dialog
        open={logModalOpen}
        onOpenChange={(next) => {
          setLogModalOpen(next)
          if (next) void fetchServerLogs()
        }}>
        <DialogContent className="max-h-[70vh] sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>{t('settings.mcp.logs', 'Server Logs')}</DialogTitle>
          </DialogHeader>
          <LogList>
            {logs.length === 0 && (
              <span className="text-foreground-muted text-sm">{t('settings.mcp.noLogs', 'No logs yet')}</span>
            )}
            {logs.map((log, idx) => (
              <LogItem key={`${log.timestamp}-${idx}`}>
                <LogHeader>
                  <Timestamp>{new Date(log.timestamp).toLocaleTimeString()}</Timestamp>
                  <Badge variant="outline" className={mapLogLevelClass(log.level)}>
                    {log.level}
                  </Badge>
                  <LogMessage>{log.message}</LogMessage>
                </LogHeader>
                {log.data && (
                  <PreBlock>{typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2)}</PreBlock>
                )}
              </LogItem>
            ))}
          </LogList>
        </DialogContent>
      </Dialog>
    </Container>
  )
}

const Container = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof Scrollbar>) => (
  <Scrollbar className={cn('h-[calc(100vh-var(--navbar-height))] min-w-0', className)} {...props} />
)

const ServerName = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('block min-w-0 font-medium text-sm', className)} {...props} />
)

const McpFormSection = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('border-border/60 border-t pt-5 first:border-t-0 first:pt-0', className)} {...props} />
)

const McpFormGrid = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('grid grid-cols-1 items-start gap-x-4 gap-y-4 xl:grid-cols-2', className)} {...props} />
)

const mcpInlineSettingItemClassName =
  'flex h-14 min-w-0 flex-row items-center justify-between gap-4 rounded-md border border-border/70 px-3'

const AdvancedSettingsButton = ({
  className,
  type = 'button',
  variant = 'ghost',
  size = 'sm',
  ...props
}: React.ComponentPropsWithoutRef<typeof Button>) => (
  <Button
    type={type}
    variant={variant}
    size={size}
    className={cn('h-8 w-fit gap-1.5 px-2 text-primary hover:text-primary', className)}
    {...props}
  />
)

const LogList = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof Scrollbar>) => (
  <Scrollbar className={cn('flex flex-col gap-3 pt-1.25 pb-3.75', className)} {...props} />
)

const LogItem = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('rounded-lg border border-border bg-card px-3 py-2.5 text-foreground', className)} {...props} />
)

const LogHeader = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex flex-wrap items-baseline gap-2', className)} {...props} />
)

const Timestamp = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('shrink-0 text-foreground-muted text-xs', className)} {...props} />
)

const LogMessage = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('break-words text-[13px] leading-normal', className)} {...props} />
)

const PreBlock = ({ className, ...props }: React.ComponentPropsWithoutRef<'pre'>) => (
  <pre
    className={cn(
      'mt-1.5 whitespace-pre-wrap break-words rounded-md border border-border bg-background px-2 py-2 text-foreground text-xs',
      className
    )}
    {...props}
  />
)

function mapLogLevelClass(level: MCPServerLogEntry['level']) {
  switch (level) {
    case 'error':
    case 'stderr':
      return 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
    case 'warn':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
    case 'info':
    case 'stdout':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400'
    default:
      return 'border-border/60 bg-muted text-muted-foreground'
  }
}

const VersionBadge = ({ count, className, ...props }: { count: string } & React.ComponentProps<'span'>) => (
  <span
    className={cn(
      'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] bg-primary px-1.5 font-medium text-[11px] text-white leading-[18px] shadow-sm',
      className
    )}
    {...props}>
    {count}
  </span>
)

interface TagsInputProps {
  value: string[]
  onChange: (next: string[]) => void
}

const TagsInput = ({ value, onChange }: TagsInputProps) => {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')

  const commit = (raw: string) => {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !value.includes(s))
    if (parts.length > 0) {
      onChange([...value, ...parts])
    }
    setDraft('')
  }

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
      {value.map((tag, index) => (
        <span
          key={`${tag}-${index}`}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-foreground text-xs">
          {tag}
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => removeAt(index)}>
            <X size={12} className="lucide-custom" />
          </button>
        </span>
      ))}
      <input
        className="min-w-[120px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        value={draft}
        placeholder={t('settings.mcp.tagsPlaceholder', 'Enter tags')}
        onChange={(e) => {
          const next = e.target.value
          if (next.endsWith(',')) {
            commit(next)
          } else {
            setDraft(next)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            e.preventDefault()
            commit(draft)
          } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            removeAt(value.length - 1)
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit(draft)
        }}
      />
    </div>
  )
}

export default McpSettings
