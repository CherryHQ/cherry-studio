'use client'

import { useState } from 'react'

import { Navigation } from '@/components/navigation'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { ProviderEditForm } from '@/components/provider-edit-form'
// Import SWR hooks and utilities
import { getErrorMessage, useDebounce, useProviders, useSyncProvider, useUpdateProvider } from '@/lib/api-client'
import type { Provider } from '@/lib/catalog-types'
import { toast } from 'sonner'

// Simple Pagination Component
function SimplePagination({
  currentPage,
  totalPages,
  onPageChange
}: {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}) {
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
    if (totalPages <= 5) return i + 1
    if (currentPage <= 3) return i + 1
    if (currentPage >= totalPages - 2) return totalPages - 4 + i
    return currentPage - 2 + i
  })

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage <= 1}>
        Previous
      </Button>
      {pages.map((page) => (
        <Button
          key={page}
          variant={currentPage === page ? 'default' : 'outline'}
          size="sm"
          onClick={() => onPageChange(page)}>
          {page}
        </Button>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}>
        Next
      </Button>
    </div>
  )
}

export default function ProvidersPage() {
  // Form state
  const [search, setSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)
  const [jsonContent, setJsonContent] = useState('')
  const [editMode, setEditMode] = useState<'form' | 'json'>('form')

  // Debounce search to avoid excessive API calls
  const debouncedSearch = useDebounce(search, 300)

  // SWR hook for fetching providers
  const {
    data: providersData,
    error,
    isLoading,
    mutate: refetchProviders
  } = useProviders({
    page: currentPage,
    limit: 20,
    search: debouncedSearch
  })

  // SWR mutation for updating providers
  const { trigger: updateProvider, isMutating: isUpdating } = useUpdateProvider()

  // SWR mutation for syncing provider models
  const { trigger: syncProvider, isMutating: isSyncing } = useSyncProvider()

  // Extract data from SWR response
  const providers = providersData?.data || []
  const pagination = providersData?.pagination || {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrev: false
  }

  const handleEdit = (provider: Provider) => {
    setEditingProvider(provider)
    setJsonContent(JSON.stringify(provider, null, 2))
  }

  const handleSave = async (data?: Partial<Provider>) => {
    if (!editingProvider) return

    try {
      let updatedProvider: Partial<Provider>

      if (data) {
        // Form submission
        updatedProvider = data
      } else {
        // JSON submission
        const parsed = JSON.parse(jsonContent) as unknown
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Invalid JSON format')
        }
        updatedProvider = parsed as Partial<Provider>
      }

      // Use SWR mutation for optimistic update
      await updateProvider({
        id: editingProvider.id,
        data: updatedProvider
      })

      // Show success toast
      toast.success('Provider updated successfully', {
        description: `${editingProvider.name} has been updated`
      })

      // Close dialog and reset form
      setEditingProvider(null)
      setJsonContent('')
    } catch (error) {
      console.error('Error saving provider:', error)
      // Show error toast
      toast.error('Failed to update provider', {
        description: error instanceof Error ? error.message : 'Unknown error occurred'
      })
    }
  }

  const handleSync = async (provider: Provider) => {
    if (!provider.models_api || !provider.models_api.enabled) {
      toast.error('Sync not available', {
        description: 'This provider does not have models_api configured'
      })
      return
    }

    try {
      // Show loading toast
      const loadingToast = toast.loading(`Syncing models from ${provider.name}...`, {
        description: 'This may take a few moments'
      })

      // Trigger sync
      const result = await syncProvider({
        id: provider.id,
        apiKey: undefined // TODO: Add API key input if needed
      })

      // Dismiss loading toast
      toast.dismiss(loadingToast)

      // Show success toast with statistics
      const stats = result.statistics
      toast.success(`Successfully synced ${provider.name}`, {
        description: `Fetched: ${stats.fetched}, New: ${stats.newModels}, Overrides: ${stats.overridesGenerated + stats.overridesMerged}`
      })

      // Refresh provider list to show updated last_synced
      refetchProviders()
    } catch (error) {
      console.error('Error syncing provider:', error)
      toast.error('Failed to sync models', {
        description: error instanceof Error ? error.message : 'Unknown error occurred'
      })
    }
  }

  // Type-safe function to extract provider formats
  const getFormats = (provider: Provider): string[] => {
    return provider.formats?.map((f) => f.format) || []
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Provider Management</h1>
          <p className="text-muted-foreground">Review and validate provider configurations</p>
        </div>
        <Navigation />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Filter providers to review specific configurations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Input
              placeholder="Search providers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{getErrorMessage(error)}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Providers ({pagination.total})</CardTitle>
          <CardDescription>Review provider configurations and capabilities</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">
              <div className="animate-pulse">Loading providers...</div>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Authentication</TableHead>
                    <TableHead>Formats</TableHead>
                    <TableHead>Endpoints</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {providers.map((provider) => (
                    <TableRow key={provider.id}>
                      <TableCell className="font-mono text-sm">{provider.id}</TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{provider.name}</div>
                          {provider.description && (
                            <div className="text-sm text-muted-foreground">{provider.description}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{provider.authentication}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {getFormats(provider).slice(0, 2).map((format) => (
                            <Badge key={format} variant="secondary" className="text-xs">
                              {format}
                            </Badge>
                          ))}
                          {getFormats(provider).length > 2 && (
                            <Badge variant="secondary" className="text-xs">
                              +{getFormats(provider).length - 2}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {provider.supported_endpoints?.slice(0, 2).map((endpoint) => (
                            <Badge key={endpoint} variant="outline" className="text-xs">
                              {endpoint}
                            </Badge>
                          )) || <span className="text-muted-foreground text-xs">N/A</span>}
                          {(provider.supported_endpoints?.length || 0) > 2 && (
                            <Badge variant="outline" className="text-xs">
                              +{(provider.supported_endpoints?.length || 0) - 2}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {provider.deprecated && (
                            <Badge variant="destructive" className="text-xs">
                              Deprecated
                            </Badge>
                          )}
                          {!provider.deprecated && (
                            <Badge variant="default" className="text-xs">
                              Active
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {provider.models_api && provider.models_api.enabled && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => handleSync(provider)}
                              disabled={isSyncing}
                              title={
                                provider.models_api.last_synced
                                  ? `Last synced: ${new Date(provider.models_api.last_synced).toLocaleString()}`
                                  : 'Sync models from provider API'
                              }>
                              {isSyncing ? 'Syncing...' : 'Sync'}
                            </Button>
                          )}
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="outline" size="sm" onClick={() => handleEdit(provider)}>
                                Edit
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                            <DialogHeader>
                              <div className="flex items-center justify-between">
                                <div>
                                  <DialogTitle>Edit Provider Configuration</DialogTitle>
                                  <DialogDescription>
                                    {editMode === 'form' ? 'Use the form below' : 'Edit JSON'} to modify {provider.name}
                                  </DialogDescription>
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    variant={editMode === 'form' ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setEditMode('form')}>
                                    Form
                                  </Button>
                                  <Button
                                    variant={editMode === 'json' ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setEditMode('json')}>
                                    JSON
                                  </Button>
                                </div>
                              </div>
                            </DialogHeader>
                            <div className="flex-1 overflow-auto">
                              {editMode === 'form' ? (
                                <ProviderEditForm
                                  provider={provider}
                                  onSave={handleSave}
                                  onCancel={() => setEditingProvider(null)}
                                  isSaving={isUpdating}
                                />
                              ) : (
                                <div className="space-y-4">
                                  <Textarea
                                    value={jsonContent}
                                    onChange={(e) => setJsonContent(e.target.value)}
                                    className="min-h-[500px] font-mono text-sm"
                                  />
                                  <div className="flex gap-3 justify-end">
                                    <Button
                                      variant="outline"
                                      onClick={() => setEditingProvider(null)}
                                      className="min-w-[100px]">
                                      Cancel
                                    </Button>
                                    <Button
                                      onClick={() => handleSave()}
                                      disabled={isUpdating}
                                      className="min-w-[140px] bg-primary hover:bg-primary/90">
                                      {isUpdating ? 'Saving...' : 'Save Changes'}
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Separator className="my-4" />

              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
                  {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} providers
                </div>
                <SimplePagination
                  currentPage={pagination.page}
                  totalPages={pagination.totalPages}
                  onPageChange={setCurrentPage}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
