import {
  Button,
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  InfoTooltip,
  Input,
  Tooltip
} from '@cherrystudio/ui'
import { getProviderWebsites } from '@renderer/config/webSearch'
import { formatApiKeys } from '@renderer/utils'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { Check, Eye, EyeOff, List, Loader2 } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { useApiProviderSettings } from '../../hooks/useApiProviderSettings'

interface Props {
  provider: WebSearchProvider
  updateProvider: (updates: Partial<WebSearchProvider>) => void
}

const ApiProviderSettings: FC<Props> = ({ provider, updateProvider }) => {
  const { t } = useTranslation()

  const {
    apiKey,
    setApiKey,
    apiHost,
    setApiHost,
    basicAuthUsername,
    setBasicAuthUsername,
    basicAuthPassword,
    setBasicAuthPassword,
    apiChecking,
    apiValid,
    showApiKey,
    showBasicAuthPassword,
    handleFieldBlur,
    openApiKeyList,
    checkSearch,
    toggleShowApiKey,
    toggleShowBasicAuthPassword
  } = useApiProviderSettings({ provider, updateProvider })

  const websites = getProviderWebsites(provider.id)
  const apiKeyWebsite = websites?.apiKey

  return (
    <FieldGroup>
      {/* API Key Field */}
      {provider.id !== 'exa-mcp' && (
        <Field>
          <FieldLabel className="justify-between">
            {t('settings.provider.api_key.label')}
            <Tooltip content={t('settings.provider.api.key.list.open')} delay={500}>
              <Button variant="ghost" size="icon-sm" onClick={openApiKeyList}>
                <List size={14} />
              </Button>
            </Tooltip>
          </FieldLabel>
          <FieldContent>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  placeholder={t('settings.provider.api_key.label')}
                  onChange={(e) => setApiKey(formatApiKeys(e.target.value))}
                  onBlur={() => handleFieldBlur('apiKey', apiKey)}
                  spellCheck={false}
                  autoFocus={apiKey === ''}
                  className="rounded-2xs pr-10"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="-translate-y-1/2 absolute top-1/2 right-2"
                  onClick={toggleShowApiKey}>
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
              </div>
              <Button
                className="h-9 rounded-2xs"
                variant={apiChecking ? 'ghost' : 'outline'}
                onClick={checkSearch}
                disabled={apiChecking}>
                {apiChecking ? (
                  <Loader2 size={16} className="animate-spin text-primary" />
                ) : apiValid ? (
                  <Check size={16} className="text-primary" />
                ) : (
                  t('settings.tool.websearch.check')
                )}
              </Button>
            </div>
            <FieldDescription className="flex justify-between text-[11px]">
              <div className="flex items-center gap-2">
                {apiKeyWebsite && (
                  <a
                    target="_blank"
                    rel="noopener noreferrer"
                    href={apiKeyWebsite}
                    className="text-[11px] text-primary opacity-70 hover:opacity-100">
                    {t('settings.provider.get_api_key')}
                  </a>
                )}
              </div>
              <span className="opacity-40">{t('settings.provider.api_key.tip')}</span>
            </FieldDescription>
          </FieldContent>
        </Field>
      )}

      {/* API Host Field */}
      <Field>
        <FieldLabel>{t('settings.provider.api_host')}</FieldLabel>
        <FieldContent>
          <Input
            className="rounded-2xs"
            value={apiHost}
            placeholder={t('settings.provider.api_host')}
            onChange={(e) => setApiHost(e.target.value)}
            onBlur={() => handleFieldBlur('apiHost', apiHost)}
          />
        </FieldContent>
      </Field>

      {/* Basic Auth Fields (SearXNG only) */}
      {provider.id === 'searxng' && (
        <>
          <FieldSeparator />
          <Field>
            <FieldLabel>
              {t('settings.provider.basic_auth.label')}
              <InfoTooltip
                placement="right"
                content={t('settings.provider.basic_auth.tip')}
                iconProps={{
                  size: 16,
                  color: 'var(--color-icon)',
                  className: 'ml-1 cursor-pointer'
                }}
              />
            </FieldLabel>
            <FieldContent>
              <Input
                value={basicAuthUsername}
                placeholder={t('settings.provider.basic_auth.user_name.tip')}
                onChange={(e) => setBasicAuthUsername(e.target.value)}
                onBlur={() => handleFieldBlur('basicAuthUsername', basicAuthUsername)}
              />
            </FieldContent>
          </Field>
          {basicAuthUsername && (
            <Field>
              <FieldLabel>{t('settings.provider.basic_auth.password.label')}</FieldLabel>
              <FieldContent>
                <div className="relative">
                  <Input
                    type={showBasicAuthPassword ? 'text' : 'password'}
                    value={basicAuthPassword}
                    placeholder={t('settings.provider.basic_auth.password.tip')}
                    onChange={(e) => setBasicAuthPassword(e.target.value)}
                    onBlur={() => handleFieldBlur('basicAuthPassword', basicAuthPassword)}
                    className="pr-10"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="-translate-y-1/2 absolute top-1/2 right-2"
                    onClick={toggleShowBasicAuthPassword}>
                    {showBasicAuthPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                </div>
              </FieldContent>
            </Field>
          )}
        </>
      )}
    </FieldGroup>
  )
}

export default ApiProviderSettings
