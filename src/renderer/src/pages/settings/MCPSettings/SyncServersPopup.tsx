import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { zodResolver } from '@hookform/resolvers/zod'
import { TopView } from '@renderer/components/TopView'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { cn } from '@renderer/utils/style'
import type { MCPServer } from '@shared/data/types/mcpServer'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { getAI302Token, saveAI302Token, syncAi302Servers } from './providers/302ai'
import { getBailianToken, saveBailianToken, syncBailianServers } from './providers/bailian'
import { getTokenLanYunToken, LANYUN_KEY_HOST, saveTokenLanYunToken, syncTokenLanYunServers } from './providers/lanyun'
import { getModelScopeToken, MODELSCOPE_HOST, saveModelScopeToken, syncModelScopeServers } from './providers/modelscope'
import { getTokenFluxToken, saveTokenFluxToken, syncTokenFluxServers, TOKENFLUX_HOST } from './providers/tokenflux'

// Provider configuration interface
interface ProviderConfig {
  key: string
  /** i18n key for provider name, or plain text if not starting with 'provider.' */
  nameKey: string
  /** i18n key for provider description */
  descriptionKey: string
  discoverUrl: string
  apiKeyUrl: string
  tokenFieldName: string
  getToken: () => string | null
  saveToken: (token: string) => void
  syncServers: (token: string, existingServers: MCPServer[]) => Promise<any>
}

// Provider configurations
const providers: ProviderConfig[] = [
  {
    key: 'modelscope',
    nameKey: 'ModelScope',
    descriptionKey: 'settings.mcp.sync.providerDescriptions.modelscope',
    discoverUrl: `${MODELSCOPE_HOST}/mcp?hosted=1&page=1`,
    apiKeyUrl: `${MODELSCOPE_HOST}/my/myaccesstoken`,
    tokenFieldName: 'modelScopeToken',
    getToken: getModelScopeToken,
    saveToken: saveModelScopeToken,
    syncServers: syncModelScopeServers
  },
  {
    key: 'tokenflux',
    nameKey: 'TokenFlux',
    descriptionKey: 'settings.mcp.sync.providerDescriptions.tokenflux',
    discoverUrl: `${TOKENFLUX_HOST}/mcps`,
    apiKeyUrl: `${TOKENFLUX_HOST}/dashboard/api-keys`,
    tokenFieldName: 'tokenfluxToken',
    getToken: getTokenFluxToken,
    saveToken: saveTokenFluxToken,
    syncServers: syncTokenFluxServers
  },
  {
    key: 'lanyun',
    nameKey: 'provider.lanyun',
    descriptionKey: 'settings.mcp.sync.providerDescriptions.lanyun',
    discoverUrl: 'https://mcp.lanyun.net',
    apiKeyUrl: LANYUN_KEY_HOST,
    tokenFieldName: 'tokenLanyunToken',
    getToken: getTokenLanYunToken,
    saveToken: saveTokenLanYunToken,
    syncServers: syncTokenLanYunServers
  },
  {
    key: '302ai',
    nameKey: '302.AI',
    descriptionKey: 'settings.mcp.sync.providerDescriptions.302ai',
    discoverUrl: 'https://302.ai',
    apiKeyUrl: 'https://dash.302.ai/apis/list',
    tokenFieldName: 'token302aiToken',
    getToken: getAI302Token,
    saveToken: saveAI302Token,
    syncServers: syncAi302Servers
  },
  {
    key: 'bailian',
    nameKey: 'provider.dashscope',
    descriptionKey: 'settings.mcp.sync.providerDescriptions.bailian',
    discoverUrl: `https://bailian.console.aliyun.com/?tab=mcp#/mcp-market`,
    apiKeyUrl: `https://bailian.console.aliyun.com/?tab=app#/api-key`,
    tokenFieldName: 'bailianToken',
    getToken: getBailianToken,
    saveToken: saveBailianToken,
    syncServers: syncBailianServers
  }
]

/**
 * Helper function to get the display name for a provider.
 * Translates if nameKey starts with 'provider.', otherwise returns as-is.
 */
const getProviderDisplayName = (provider: ProviderConfig, t: (key: string) => string): string => {
  return provider.nameKey.startsWith('provider.') ? t(provider.nameKey) : provider.nameKey
}

interface Props {
  resolve: (data: any) => void
  existingServers: MCPServer[]
}

const schema = z.object({
  token: z.string().min(1)
})
type FieldType = z.infer<typeof schema>

const PopupContainer: React.FC<Props> = ({ resolve, existingServers }) => {
  const { addMCPServer, refetch } = useMCPServers()
  const [open, setOpen] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [selectedProviderKey, setSelectedProviderKey] = useState(providers[0].key)
  const didResolveRef = useRef(false)
  const { t } = useTranslation()

  const selectedProvider = providers.find((p) => p.key === selectedProviderKey) || providers[0]

  const form = useForm<FieldType>({
    resolver: zodResolver(schema),
    defaultValues: { token: selectedProvider.getToken() ?? '' }
  })

  useEffect(() => {
    form.reset({ token: selectedProvider.getToken() ?? '' })
  }, [selectedProvider, form])

  const closeAndResolve = useCallback(() => {
    if (didResolveRef.current) {
      return
    }
    didResolveRef.current = true
    setOpen(false)
    resolve({})
  }, [resolve])

  const handleSync = useCallback(
    async (values: FieldType) => {
      setIsSyncing(true)
      try {
        const token = values.token.trim()
        if (token) {
          selectedProvider.saveToken(token)
        }

        const result = await selectedProvider.syncServers(token, existingServers)

        if (result.success && (result.addedServers?.length > 0 || result.updatedServers?.length > 0)) {
          for (const server of result.addedServers) {
            await addMCPServer(server)
          }
          const updatedServers = result.updatedServers
          if (updatedServers?.length > 0) {
            for (const server of updatedServers) {
              const { id, ...updates } = server
              await dataApiService.patch(`/mcp-servers/${id}`, { body: updates })
            }
            await refetch()
          }
          window.toast.success(result.message)
          closeAndResolve()
        } else if (result.success) {
          window.toast.info(result.message)
        } else {
          window.toast.error(result.message)
        }
      } catch (error: any) {
        window.toast.error(`${t('settings.mcp.sync.error')}: ${error.message}`)
      } finally {
        setIsSyncing(false)
      }
    },
    [addMCPServer, refetch, existingServers, selectedProvider, t, closeAndResolve]
  )

  SyncServersPopup.hide = closeAndResolve

  const tokenValue = form.watch('token')
  const isSyncDisabled = !tokenValue?.trim()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeAndResolve()
      }}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>{t('settings.mcp.sync.title', 'Sync Servers')}</DialogTitle>
        </DialogHeader>
        <ContentContainer>
          <ProviderSelector>
            <Label>{t('settings.mcp.sync.selectProvider', 'Select Provider:')}</Label>
            <Select value={selectedProviderKey} onValueChange={setSelectedProviderKey}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectItem key={provider.key} value={provider.key}>
                    {getProviderDisplayName(provider, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ProviderSelector>

          <ProviderContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSync)} className="w-full">
                <StepSection>
                  <StepNumber>1</StepNumber>
                  <StepContent>
                    <StepTitle>{t('settings.mcp.sync.discoverMcpServers', 'Discover MCP Servers')}</StepTitle>
                    <StepDescription>
                      {t(
                        'settings.mcp.sync.discoverMcpServersDescription',
                        'Visit the platform to discover available MCP servers'
                      )}
                    </StepDescription>
                    <LinkContainer>
                      <ExternalLink href={selectedProvider.discoverUrl} target="_blank">
                        <LinkIcon>🌐</LinkIcon>
                        <span>{t('settings.mcp.sync.discoverMcpServers', 'Discover MCP Servers')}</span>
                      </ExternalLink>
                    </LinkContainer>
                  </StepContent>
                </StepSection>

                <StepSection>
                  <StepNumber>2</StepNumber>
                  <StepContent>
                    <StepTitle>{t('settings.mcp.sync.getToken', 'Get API Token')}</StepTitle>
                    <StepDescription>
                      {t('settings.mcp.sync.getTokenDescription', 'Retrieve your personal API token from your account')}
                    </StepDescription>
                    <LinkContainer>
                      <ExternalLink href={selectedProvider.apiKeyUrl} target="_blank">
                        <LinkIcon>🔑</LinkIcon>
                        <span>{t('settings.mcp.sync.getToken', 'Get API Token')}</span>
                      </ExternalLink>
                    </LinkContainer>
                  </StepContent>
                </StepSection>

                <StepSection>
                  <StepNumber>3</StepNumber>
                  <StepContent>
                    <StepTitle>{t('settings.mcp.sync.setToken', 'Enter Your Token')}</StepTitle>
                    <FormField
                      control={form.control}
                      name="token"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input
                              type="password"
                              placeholder={t('settings.mcp.sync.tokenPlaceholder', 'Enter API token here')}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </StepContent>
                </StepSection>

                <ButtonContainer>
                  <Button type="button" variant="outline" onClick={closeAndResolve}>
                    {t('common.cancel')}
                  </Button>
                  <Button type="submit" disabled={isSyncing || isSyncDisabled}>
                    {t('settings.mcp.sync.button', 'Sync')}
                  </Button>
                </ButtonContainer>
              </form>
            </Form>
          </ProviderContent>
        </ContentContainer>
      </DialogContent>
    </Dialog>
  )
}

const ContentContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex flex-col gap-2.5', className)} {...props} />
)

const ProviderSelector = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-3.75 flex items-center gap-3', className)} {...props} />
)

const ProviderContent = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('border-border border-t pt-5', className)} {...props} />
)

const StepSection = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-5 flex items-start gap-3.75', className)} {...props} />
)

const StepNumber = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-sm text-white',
      className
    )}
    {...props}
  />
)

const StepContent = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex grow flex-col', className)} {...props} />
)

const StepTitle = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-1 font-semibold text-[15px]', className)} {...props} />
)

const StepDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-2 text-[13px] text-foreground-secondary', className)} {...props} />
)

const LinkContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-1', className)} {...props} />
)

const ExternalLink = ({ className, ...props }: React.ComponentPropsWithoutRef<'a'>) => (
  <a
    className={cn(
      'flex items-center gap-2 rounded-md bg-background-subtle px-2.5 py-2 text-primary text-sm transition-all hover:bg-muted hover:no-underline',
      className
    )}
    {...props}
  />
)

const LinkIcon = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('text-base', className)} {...props} />
)

const ButtonContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex justify-end gap-2 border-border border-t pt-3.75', className)} {...props} />
)

const TopViewKey = 'SyncServersPopup'

export default class SyncServersPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(existingServers: MCPServer[]) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          existingServers={existingServers}
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
