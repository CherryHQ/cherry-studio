import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type { WebSearchProviderOverride } from '@shared/data/presets/web-search-providers'
import { ExternalLink } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { Fragment } from 'react'

import ApiProviderSettings from './ApiProviderSettings'
import LocalProviderSettings from './LocalProviderSettings'
import McpProviderSettings from './McpProviderSettings'

interface ProviderSettingsHeaderProps {
  logoSrc?: string
  name: string
  officialWebsite?: string
}

const ProviderSettingsRoot: FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <div className="w-full px-4 py-2">
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

const ProviderSettingsHeader: FC<ProviderSettingsHeaderProps> = ({ logoSrc, name, officialWebsite }) => {
  return (
    <div className="flex items-center gap-2">
      {logoSrc && <img src={logoSrc} alt={name} className="h-5 w-5 rounded object-contain" />}
      <span className="font-medium text-sm">{name}</span>
      {officialWebsite && (
        <a target="_blank" href={officialWebsite} rel="noopener noreferrer">
          <ExternalLink size={14} />
        </a>
      )}
    </div>
  )
}

const ProviderSettingsDivider: FC = () => {
  return <div className="border-border border-b" />
}

const ProviderSettingsBody: FC<{ children: ReactNode }> = ({ children }) => {
  return <Fragment>{children}</Fragment>
}

const ProviderSettingsApi: FC<{
  provider: WebSearchProvider
  updateProvider: (updates: WebSearchProviderOverride) => void
}> = (props) => {
  return <ApiProviderSettings {...props} />
}

const ProviderSettingsMcp: FC<{
  provider: WebSearchProvider
  updateProvider: (updates: WebSearchProviderOverride) => void
}> = (props) => {
  return <McpProviderSettings {...props} />
}

const ProviderSettingsLocal: FC<{ provider: WebSearchProvider }> = (props) => {
  return <LocalProviderSettings {...props} />
}

export const ProviderSettingsLayout = Object.assign(ProviderSettingsRoot, {
  Header: ProviderSettingsHeader,
  Divider: ProviderSettingsDivider,
  Body: ProviderSettingsBody,
  Api: ProviderSettingsApi,
  Mcp: ProviderSettingsMcp,
  Local: ProviderSettingsLocal
})
