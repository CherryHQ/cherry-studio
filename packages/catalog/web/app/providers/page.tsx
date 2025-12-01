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
// Import SWR hooks and utilities
import { getErrorMessage, useDebounce, useProviders, useUpdateProvider } from '@/lib/api-client'
import type { Provider } from '@/lib/catalog-types'

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

  const handleSave = async () => {
    if (!editingProvider) return

    try {
      // Validate JSON before sending
      const updatedProvider = JSON.parse(jsonContent) as unknown

      // Basic validation - the API will do thorough validation
      if (!updatedProvider || typeof updatedProvider !== 'object') {
        throw new Error('Invalid JSON format')
      }

      // Use SWR mutation for optimistic update
      await updateProvider({
        id: editingProvider.id,
        data: updatedProvider as Partial<Provider>
      })

      // Close dialog and reset form
      setEditingProvider(null)
      setJsonContent('')
    } catch (error) {
      console.error('Error saving provider:', error)
      // Error will be handled by SWR and displayed in UI
    }
  }

  // Type-safe function to extract provider capabilities
  const getCapabilities = (behaviors: Record<string, unknown>): string[] => {
    return Object.entries(behaviors)
      .filter(([_, value]) => value === true)
      .map(([key, _]) => key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()))
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
                    <TableHead>Pricing Model</TableHead>
                    <TableHead>Endpoints</TableHead>
                    <TableHead>Capabilities</TableHead>
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
                        <Badge variant="secondary">{provider.pricing_model}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {provider.supported_endpoints.slice(0, 2).map((endpoint) => (
                            <Badge key={endpoint} variant="outline" className="text-xs">
                              {endpoint}
                            </Badge>
                          ))}
                          {provider.supported_endpoints.length > 2 && (
                            <Badge variant="outline" className="text-xs">
                              +{provider.supported_endpoints.length - 2}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {getCapabilities(provider.behaviors)
                            .slice(0, 2)
                            .map((capability) => (
                              <Badge key={capability} variant="secondary" className="text-xs">
                                {capability}
                              </Badge>
                            ))}
                          {getCapabilities(provider.behaviors).length > 2 && (
                            <Badge variant="secondary" className="text-xs">
                              +{getCapabilities(provider.behaviors).length - 2}
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
                          {provider.maintenance_mode && (
                            <Badge variant="outline" className="text-xs">
                              Maintenance
                            </Badge>
                          )}
                          {!provider.deprecated && !provider.maintenance_mode && (
                            <Badge variant="default" className="text-xs">
                              Active
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm" onClick={() => handleEdit(provider)}>
                              Edit
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
                            <DialogHeader>
                              <DialogTitle>Edit Provider Configuration</DialogTitle>
                              <DialogDescription>Modify the JSON configuration for {provider.name}</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4">
                              <Textarea
                                value={jsonContent}
                                onChange={(e) => setJsonContent(e.target.value)}
                                className="min-h-[400px] font-mono text-sm"
                              />
                              <div className="flex gap-2 justify-end">
                                <Button variant="outline" onClick={() => setEditingProvider(null)}>
                                  Cancel
                                </Button>
                                <Button onClick={handleSave} disabled={isUpdating}>
                                  {isUpdating ? 'Saving...' : 'Save Changes'}
                                </Button>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
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
