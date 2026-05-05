import { Badge, Button, Center, Flex, Input, RowFlex, Spinner } from '@cherrystudio/ui'
import logo from '@renderer/assets/images/cherry-text-logo.svg'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import type { MCPServer } from '@renderer/types'
import { getMcpConfigSampleFromReadme } from '@renderer/utils'
import { Check, Plus } from 'lucide-react'
import { npxFinder } from 'npx-scope-finder'
import { type FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface SearchResult {
  name: string
  description: string
  version: string
  usage: string
  npmLink: string
  fullName: string
  type: MCPServer['type']
  configSample?: MCPServer['configSample']
}

const npmScopes = ['@modelcontextprotocol', '@gongrzhe', '@mcpmarket']

let _searchResults: SearchResult[] = []

const NpxSearch: FC = () => {
  const { t } = useTranslation()

  // Add new state variables for npm scope search
  const [npmScope, setNpmScope] = useState('@modelcontextprotocol')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>(_searchResults)
  const { addMCPServer, mcpServers } = useMCPServers()

  _searchResults = searchResults

  // Add new function to handle npm scope search
  const handleNpmSearch = async (scopeOverride?: string) => {
    const searchScope = scopeOverride || npmScope

    if (!searchScope.trim()) {
      window.toast.warning(t('settings.mcp.npx_list.scope_required'))
      return
    }

    if (searchLoading) {
      return
    }

    setSearchLoading(true)

    try {
      // Call npxFinder to search for packages
      const packages = await npxFinder(searchScope)
      // Map the packages to our desired format
      const formattedResults: SearchResult[] = packages.map((pkg) => {
        let configSample
        if (pkg.original?.readme) {
          configSample = getMcpConfigSampleFromReadme(pkg.original.readme)
        }

        return {
          key: pkg.name,
          name: pkg.name?.split('/')[1] || '',
          description: pkg.description || 'No description available',
          version: pkg.version || 'Latest',
          usage: `npx ${pkg.name}`,
          npmLink: pkg.links?.npm || `https://www.npmjs.com/package/${pkg.name}`,
          fullName: pkg.name || '',
          type: 'stdio',
          configSample
        }
      })

      setSearchResults(formattedResults)

      if (formattedResults.length === 0) {
        window.toast.info(t('settings.mcp.npx_list.no_packages'))
      }
    } catch (error: unknown) {
      setSearchResults([])
      _searchResults = []
      if (error instanceof Error) {
        window.toast.error(`${t('settings.mcp.npx_list.search_error')}: ${error.message}`)
      } else {
        window.toast.error(t('settings.mcp.npx_list.search_error'))
      }
    } finally {
      setSearchLoading(false)
    }
  }

  useEffect(() => {
    void handleNpmSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 pt-5">
      <Center>
        <div className="mb-[25px] flex w-full max-w-[500px] flex-col px-4">
          <Center className="mb-3.75">
            <img src={logo} alt="npm" width={120} />
          </Center>
          <div className="w-full">
            <Input
              placeholder={t('settings.mcp.npx_list.scope_placeholder')}
              value={npmScope}
              onChange={(e) => setNpmScope(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void handleNpmSearch(npmScope)
                }
              }}
              className="h-10 rounded-full"
            />
          </div>
          <RowFlex className="items-center justify-center">
            {npmScopes.map((scope) => (
              <Badge
                key={scope}
                onClick={() => {
                  setNpmScope(scope)
                  void handleNpmSearch(scope)
                }}
                className="cursor-pointer border-border bg-background-subtle text-foreground hover:bg-accent data-[disabled=true]:cursor-not-allowed"
                data-disabled={searchLoading}>
                {scope}
              </Badge>
            ))}
          </RowFlex>
        </div>
      </Center>
      {searchLoading && (
        <Center>
          <Spinner text={t('common.loading')} />
        </Center>
      )}
      {!searchLoading && (
        <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {searchResults?.map((record) => {
            const isInstalled = mcpServers.some((server) => server.name === record.name)
            return (
              <div
                key={record.name}
                className="rounded-lg border border-transparent bg-transparent px-3 py-2 transition-colors hover:bg-accent">
                <div className="mb-1.5 flex items-start justify-between gap-3">
                  <h3 className="selectable m-0 min-w-0 truncate font-semibold text-sm leading-6">{record.name}</h3>
                  <Flex className="shrink-0 items-center gap-1">
                    <Badge className="border-success/30 bg-success/10 text-success">v{record.version}</Badge>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={async () => {
                        if (isInstalled) {
                          return
                        }

                        const newServer = {
                          name: record.name,
                          description: `${record.description}\n\n${t('settings.mcp.npx_list.usage')}: ${record.usage}\n${t('settings.mcp.npx_list.npm')}: ${record.npmLink}`,
                          command: 'npx',
                          args: record.configSample?.args ?? ['-y', record.fullName],
                          env: record.configSample?.env,
                          isActive: false,
                          type: record.type,
                          searchKey: record.fullName
                        }

                        try {
                          await addMCPServer(newServer)
                          window.toast.success(t('settings.mcp.addSuccess'))
                        } catch {
                          window.toast.error(t('settings.mcp.addError'))
                        }
                      }}
                      disabled={isInstalled}>
                      {isInstalled ? <Check size={14} className="text-primary" /> : <Plus size={14} />}
                    </Button>
                  </Flex>
                </div>
                <div className="flex flex-col gap-1">
                  <p className="selectable m-0 text-sm">{record.description}</p>
                  <p className="selectable m-0 text-muted-foreground text-sm">
                    {t('settings.mcp.npx_list.usage')}: {record.usage}
                  </p>
                  <a
                    href={record.npmLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="selectable text-link text-sm hover:text-link-hover">
                    {record.npmLink}
                  </a>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default NpxSearch
