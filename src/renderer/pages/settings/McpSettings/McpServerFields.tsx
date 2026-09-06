import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  InfoTooltip,
  Input,
  InputNumber,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea
} from '@cherrystudio/ui'
import { parseKeyValueString } from '@renderer/utils/env'
import { cn } from '@renderer/utils/style'
import { PRESET_MCP_SERVERS } from '@shared/data/presets/mcpServers'
import { type McpServer, type McpServerType, McpServerTypeSchema } from '@shared/data/types/mcpServer'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'
import type React from 'react'
import { useCallback, useState } from 'react'
import type { DefaultValues, UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

export const buildMcpSchema = (t: (key: string) => string) =>
  z
    .object({
      name: z.string().trim().min(1, t('common.name')),
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
      if (resolveMcpConfigTransportType(value.serverType, value.name) === 'stdio' && !value.command?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['command'], message: t('settings.mcp.command') })
      }
    })

export type McpFormValues = z.infer<ReturnType<typeof buildMcpSchema>>
export type McpForm = UseFormReturn<McpFormValues>

export function resolveMcpConfigTransportType(
  type: McpServer['type'],
  name: string,
  command?: string,
  baseUrl?: string
): McpServer['type'] {
  if (type !== 'inMemory') return type
  if (name === BuiltinMcpServerNames.mcpAutoInstall) return 'stdio'

  const hasInMemoryImplementation = PRESET_MCP_SERVERS.some(
    (server) => server.name === name && server.type === 'inMemory'
  )
  return !hasInMemoryImplementation && !baseUrl && command ? 'stdio' : type
}

/**
 * Env reaches the runtime for stdio and in-memory servers. Over HTTP only a built-in that
 * declares it needs configuration reads it — QVeris turns `QVERIS_API_KEY` into its auth
 * header — so every other remote server keeps the editor hidden.
 */
export function showsEnvEditor(serverType: McpServer['type'], builtinRequiresEnv?: boolean): boolean {
  return serverType === 'stdio' || serverType === 'inMemory' || Boolean(builtinRequiresEnv)
}

export function resolveMcpConfigInstallSource(
  server: Pick<McpServer, 'installSource' | 'name' | 'type'>
): McpServer['installSource'] {
  if (server.installSource) return server.installSource

  return server.type === 'inMemory' && server.name === BuiltinMcpServerNames.mcpAutoInstall
    ? 'builtin'
    : server.installSource
}

export const MCP_FORM_DEFAULT_VALUES: McpFormValues = {
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

export interface Registry {
  /** i18n key under `settings.mcp.registryOptions` for the display name. */
  nameKey: string
  url: string
}

export const NpmRegistry: Registry[] = [
  { nameKey: 'settings.mcp.registryOptions.npmTaobao', url: 'https://registry.npmmirror.com' },
  { nameKey: 'settings.mcp.registryOptions.custom', url: 'custom' }
]

export const PipRegistry: Registry[] = [
  { nameKey: 'settings.mcp.registryOptions.pipTsinghua', url: 'https://pypi.tuna.tsinghua.edu.cn/simple' },
  { nameKey: 'settings.mcp.registryOptions.pipAliyun', url: 'http://mirrors.aliyun.com/pypi/simple/' },
  { nameKey: 'settings.mcp.registryOptions.pipUstc', url: 'https://mirrors.ustc.edu.cn/pypi/simple/' },
  { nameKey: 'settings.mcp.registryOptions.pipHuawei', url: 'https://repo.huaweicloud.com/repository/pypi/simple/' },
  { nameKey: 'settings.mcp.registryOptions.pipTencent', url: 'https://mirrors.cloud.tencent.com/pypi/simple/' }
]

export const registryForCommand = (command: string): Registry[] | undefined => {
  if (command.includes('uv') || command.includes('uvx')) return PipRegistry
  if (command.includes('npx') || command.includes('bun') || command.includes('bunx')) return NpmRegistry
  return undefined
}

const getInitialRegistryState = (server?: Pick<McpServer, 'command' | 'registryUrl'>) => {
  const registry = server?.command ? registryForCommand(server.command) : undefined
  const isCustom =
    Boolean(server?.registryUrl) && Boolean(registry) && !registry?.some((reg) => reg.url === server?.registryUrl)

  return {
    registry,
    selectedRegistryType: isCustom ? 'custom' : '',
    customRegistryUrl: isCustom ? (server?.registryUrl ?? '') : ''
  }
}

/** Registry picker state shared by the detail page and the quick-create dialog. */
export function useMcpRegistryState(
  form: McpForm,
  onChanged?: () => void,
  initialServer?: Pick<McpServer, 'command' | 'registryUrl'>
) {
  const initialState = getInitialRegistryState(initialServer)
  const [registry, setRegistry] = useState<Registry[] | undefined>(initialState.registry)
  const [selectedRegistryType, setSelectedRegistryType] = useState(initialState.selectedRegistryType)
  const [customRegistryUrl, setCustomRegistryUrl] = useState(initialState.customRegistryUrl)

  const handleCommandChange = useCallback(
    (command: string) => {
      const nextRegistry = registryForCommand(command)

      if (registry !== nextRegistry) {
        const registryUrl = form.getValues('registryUrl')
        setSelectedRegistryType('')
        setCustomRegistryUrl('')
        form.setValue('registryUrl', '')
        if (registryUrl) onChanged?.()
      }

      setRegistry(nextRegistry)
    },
    [form, onChanged, registry]
  )

  const reset = useCallback(() => {
    setRegistry(undefined)
    setSelectedRegistryType('')
    setCustomRegistryUrl('')
  }, [])

  const onSelectRegistry = useCallback(
    (url: string) => {
      if (url === 'custom') {
        setSelectedRegistryType('custom')
        return
      }

      setSelectedRegistryType('')
      setCustomRegistryUrl('')
      if (registryForCommand(form.getValues('command') || '')) {
        form.setValue('registryUrl', url)
      }
      onChanged?.()
    },
    [form, onChanged]
  )

  const onCustomRegistryChange = useCallback(
    (url: string) => {
      setCustomRegistryUrl(url)
      form.setValue('registryUrl', url)
      onChanged?.()
    },
    [form, onChanged]
  )

  return {
    registry,
    selectedRegistryType,
    customRegistryUrl,
    handleCommandChange,
    reset,
    onSelectRegistry,
    onCustomRegistryChange
  }
}

export type McpRegistryState = ReturnType<typeof useMcpRegistryState>

/** Maps a persisted MCP server to the edit form's initial values without guessing missing fields. */
export function toMcpFormDefaultValues(server: McpServer): DefaultValues<McpFormValues> {
  return {
    name: server.name,
    description: server.description ?? '',
    serverType: resolveMcpConfigTransportType(server.type, server.name, server.command, server.baseUrl),
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
  }
}

/** Maps form values onto the mutable subset of an MCP server. */
export function toMcpServerFields(values: McpFormValues): Partial<McpServer> {
  const fields: Partial<McpServer> = {
    name: values.name,
    type: values.serverType,
    description: values.description,
    registryUrl: values.registryUrl,
    timeout: values.timeout,
    longRunning: values.longRunning,
    tags: values.tags
  }

  if (values.serverType === 'sse' || values.serverType === 'streamableHttp') {
    fields.baseUrl = values.baseUrl
    fields.headers = parseKeyValueString(values.headers ?? '')
  } else {
    fields.command = values.command
    fields.args = values.args ? values.args.split('\n').filter((arg) => arg.trim() !== '') : []
  }
  // Env is not stdio-only: hosted built-ins such as QVeris keep their API key here whatever
  // transport they use, so it must round-trip instead of being dropped on save.
  fields.env = parseKeyValueString(values.env ?? '')

  return fields
}

export const McpFormGrid = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('grid grid-cols-1 items-start gap-x-4 gap-y-4 xl:grid-cols-2', className)} {...props} />
)

/** Dialog layout: one column, and the same vertical rhythm as `FieldGroup`. */
const singleColumnGridClassName = 'gap-y-6 xl:grid-cols-1'

const McpFieldGroup = ({
  children,
  singleColumn
}: React.PropsWithChildren<{ singleColumn?: boolean }>): React.ReactNode =>
  singleColumn ? <McpFormGrid className={singleColumnGridClassName}>{children}</McpFormGrid> : children

const inlineSettingItemClassName =
  'flex h-14 min-w-0 flex-row items-center justify-between gap-4 rounded-md border border-border px-3'

const codeAreaClassName = 'max-h-40 min-h-21 px-3 py-2 font-mono text-sm leading-5'

interface FieldsProps {
  form: McpForm
  serverType: McpServerType | undefined
  onServerTypeChange: (type: McpServerType) => void
  registryState: McpRegistryState
  /** Built-in servers keep their identity while exposing transport-specific configuration. */
  isBuiltin?: boolean
  /** A built-in that declares `shouldConfig`: its credentials live in env whatever the transport. */
  builtinRequiresEnv?: boolean
  /** Single-column layout for the quick-create dialog. */
  singleColumn?: boolean
  /** Allows quick-create to render args before the advanced section. */
  includeArgs?: boolean
  /** Render the runtime toggles as bordered cards (detail page) instead of plain rows (dialog). */
  inlineCards?: boolean
}

/** Name / type / description — always visible. */
export function McpIdentityFields({ form, onServerTypeChange, isBuiltin, singleColumn }: FieldsProps) {
  const { t } = useTranslation()

  return (
    <McpFormGrid className={singleColumn ? singleColumnGridClassName : undefined}>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem className="min-w-0 gap-3">
            <FormLabel required>{t('settings.mcp.name')}</FormLabel>
            <FormControl>
              <Input required placeholder={t('common.name')} disabled={isBuiltin} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {!isBuiltin && (
        <FormField
          control={form.control}
          name="serverType"
          render={({ field }) => (
            <FormItem className="min-w-0 gap-3">
              <FormLabel required>{t('settings.mcp.type')}</FormLabel>
              <FormControl>
                <Select
                  required
                  value={field.value}
                  onValueChange={(value) => {
                    const serverType = McpServerTypeSchema.parse(value)
                    field.onChange(serverType)
                    onServerTypeChange(serverType)
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
          <FormItem className={cn('min-w-0 gap-3', !singleColumn && 'xl:col-span-2')}>
            <FormLabel>{t('settings.mcp.description')}</FormLabel>
            <FormControl>
              <Textarea.Input
                rows={2}
                placeholder={t('common.description')}
                className="min-h-16 px-3 py-2 text-sm leading-5"
                {...field}
              />
            </FormControl>
          </FormItem>
        )}
      />
    </McpFormGrid>
  )
}

/** The one field a server cannot run without: URL for remote types, command for stdio. */
export function McpEndpointField({ form, serverType, registryState, singleColumn }: FieldsProps) {
  const { t } = useTranslation()

  if (!serverType || serverType === 'inMemory') return null

  return (
    <McpFieldGroup singleColumn={singleColumn}>
      {serverType === 'stdio' ? (
        <FormField
          control={form.control}
          name="command"
          render={({ field }) => (
            <FormItem className="min-w-0 gap-3">
              <FormLabel required>{t('settings.mcp.command')}</FormLabel>
              <FormControl>
                <Input
                  required
                  placeholder="uvx or npx"
                  {...field}
                  onChange={(e) => {
                    field.onChange(e)
                    registryState.handleCommandChange(e.target.value)
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : (
        <FormField
          control={form.control}
          name="baseUrl"
          render={({ field }) => (
            <FormItem className="min-w-0 gap-3">
              <FormLabel required className="flex items-center gap-1">
                {t('settings.mcp.url')}
                <InfoTooltip content={t('settings.mcp.baseUrlTooltip')} />
              </FormLabel>
              <FormControl>
                <Input
                  required
                  placeholder={serverType === 'sse' ? 'http://localhost:3000/sse' : 'http://localhost:3000/mcp'}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </McpFieldGroup>
  )
}

export function McpArgsField({ form }: Pick<FieldsProps, 'form'>) {
  const { t } = useTranslation()

  return (
    <FormField
      control={form.control}
      name="args"
      render={({ field }) => (
        <FormItem className="min-w-0 gap-3">
          <FormLabel className="flex items-center gap-1">
            {t('settings.mcp.args')}
            <InfoTooltip content={t('settings.mcp.argsTooltip')} />
          </FormLabel>
          <FormControl>
            <Textarea.Input rows={3} placeholder={`arg1\narg2`} className={codeAreaClassName} {...field} />
          </FormControl>
        </FormItem>
      )}
    />
  )
}

/** Transport details: headers for remote servers, registry / args for stdio, env where credentials live. */
export function McpTransportFields({
  form,
  serverType,
  registryState,
  builtinRequiresEnv,
  singleColumn,
  includeArgs = true
}: FieldsProps) {
  const { t } = useTranslation()
  const { registry, selectedRegistryType, customRegistryUrl, onSelectRegistry, onCustomRegistryChange } = registryState

  return (
    <McpFieldGroup singleColumn={singleColumn}>
      {(serverType === 'sse' || serverType === 'streamableHttp') && (
        <FormField
          control={form.control}
          name="headers"
          render={({ field }) => (
            <FormItem className="min-w-0 gap-3">
              <FormLabel className="flex items-center gap-1">
                {t('settings.mcp.headers')}
                <InfoTooltip content={t('settings.mcp.headersTooltip')} />
              </FormLabel>
              <FormControl>
                <Textarea.Input
                  rows={3}
                  placeholder={`Content-Type=application/json\nAuthorization=Bearer token`}
                  className={codeAreaClassName}
                  {...field}
                />
              </FormControl>
            </FormItem>
          )}
        />
      )}
      {serverType === 'stdio' && registry && (
        <FormField
          control={form.control}
          name="registryUrl"
          render={({ field }) => (
            <FormItem className="min-w-0 gap-3">
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
                      {t(reg.nameKey)}
                    </label>
                  ))}
                </RadioGroup>
              </FormControl>
              {selectedRegistryType === 'custom' && (
                <Input
                  className="mt-2"
                  placeholder={t('settings.mcp.customRegistryPlaceholder')}
                  value={customRegistryUrl}
                  onChange={(e) => onCustomRegistryChange(e.target.value)}
                />
              )}
            </FormItem>
          )}
        />
      )}
      {(serverType === 'stdio' || serverType === 'inMemory') && includeArgs && <McpArgsField form={form} />}
      {showsEnvEditor(serverType, builtinRequiresEnv) && (
        <>
          <FormField
            control={form.control}
            name="env"
            render={({ field }) => (
              <FormItem className="min-w-0 gap-3">
                <FormLabel className="flex items-center gap-1">
                  {t('settings.mcp.env')}
                  <InfoTooltip content={t('settings.mcp.envTooltip')} />
                </FormLabel>
                <FormControl>
                  <Textarea.Input
                    rows={3}
                    placeholder={`KEY1=value1\nKEY2=value2`}
                    className={codeAreaClassName}
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </>
      )}
    </McpFieldGroup>
  )
}

/** Runtime behaviour: long-running flag and request timeout. */
export function McpRuntimeFields({ form, singleColumn, inlineCards = true }: FieldsProps) {
  const { t } = useTranslation()
  const rowClassName = inlineCards
    ? inlineSettingItemClassName
    : 'flex min-w-0 flex-row items-center justify-between gap-4'

  return (
    <McpFormGrid className={singleColumn ? singleColumnGridClassName : undefined}>
      <FormField
        control={form.control}
        name="longRunning"
        render={({ field }) => (
          <FormItem className={rowClassName}>
            <FormLabel className="flex items-center gap-1">
              {t('settings.mcp.longRunning')}
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
          <FormItem className={rowClassName}>
            <FormLabel className="flex items-center gap-1">
              {t('settings.mcp.timeout')}
              <InfoTooltip content={t('settings.mcp.timeoutTooltip')} />
            </FormLabel>
            {/* `FormControl` is a Slot: it puts `id={formItemId}` on its direct child, which is
                what `FormLabel`'s `htmlFor` points at. Wrapping the row would name the div. */}
            <div className="flex items-center gap-2">
              <FormControl>
                <InputNumber
                  min={1}
                  step={1}
                  placeholder="60"
                  value={field.value ?? null}
                  onBlur={(value) => field.onChange(value ?? undefined)}
                  className="h-8 w-24 py-0"
                />
              </FormControl>
              <span className="text-foreground-tertiary text-xs">s</span>
            </div>
          </FormItem>
        )}
      />
    </McpFormGrid>
  )
}
