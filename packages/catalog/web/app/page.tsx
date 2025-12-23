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
import { ModelEditForm } from '@/components/model-edit-form'
// Import SWR hooks and utilities
import { getErrorMessage, useDebounce, useModels, useProviders, useUpdateModel } from '@/lib/api-client'
import type { CapabilityType, Model } from '@/lib/catalog-types'
import { toast } from 'sonner'

// Type-safe capabilities list
const CAPABILITIES: readonly CapabilityType[] = [
  'FUNCTION_CALL',
  'REASONING',
  'IMAGE_RECOGNITION',
  'IMAGE_GENERATION',
  'AUDIO_RECOGNITION',
  'AUDIO_GENERATION',
  'EMBEDDING',
  'RERANK',
  'AUDIO_TRANSCRIPT',
  'VIDEO_RECOGNITION',
  'VIDEO_GENERATION',
  'STRUCTURED_OUTPUT',
  'FILE_INPUT',
  'WEB_SEARCH',
  'CODE_EXECUTION',
  'FILE_SEARCH',
  'COMPUTER_USE'
] as const

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

export default function CatalogReview() {
  // Form state
  const [search, setSearch] = useState('')
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([])
  const [selectedProviders, setSelectedProviders] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [editingModel, setEditingModel] = useState<Model | null>(null)
  const [jsonContent, setJsonContent] = useState('')
  const [editMode, setEditMode] = useState<'form' | 'json'>('form')

  // Debounce search to avoid excessive API calls
  const debouncedSearch = useDebounce(search, 300)

  // SWR hook for fetching models
  const {
    data: modelsData,
    error,
    isLoading
  } = useModels({
    page: currentPage,
    limit: 20,
    search: debouncedSearch,
    capabilities: selectedCapabilities.length > 0 ? selectedCapabilities : undefined,
    providers: selectedProviders.length > 0 ? selectedProviders : undefined
  })

  // SWR hook for fetching all providers
  const { data: providersData } = useProviders({
    limit: 100 // Maximum allowed limit
  })

  // SWR mutation for updating models
  const { trigger: updateModel, isMutating: isUpdating } = useUpdateModel()

  // Extract data from SWR response
  const models = modelsData?.data || []
  const pagination = modelsData?.pagination || {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrev: false
  }

  const handleEdit = (model: Model) => {
    setEditingModel(model)
    setJsonContent(JSON.stringify(model, null, 2))
  }

  const handleSave = async (data?: Partial<Model>) => {
    if (!editingModel) return

    try {
      let updatedModel: Partial<Model>

      if (data) {
        // Form submission
        updatedModel = data
      } else {
        // JSON submission
        const parsed = JSON.parse(jsonContent) as unknown
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Invalid JSON format')
        }
        updatedModel = parsed as Partial<Model>
      }

      // Use SWR mutation for optimistic update
      await updateModel({
        id: editingModel.id,
        data: updatedModel
      })

      // Show success toast
      toast.success('Model updated successfully', {
        description: `${editingModel.id} has been updated`
      })

      // Close dialog and reset form
      setEditingModel(null)
      setJsonContent('')
    } catch (error) {
      console.error('Error saving model:', error)
      // Show error toast
      toast.error('Failed to update model', {
        description: error instanceof Error ? error.message : 'Unknown error occurred'
      })
    }
  }

  // Get all unique providers from providers.json
  const allProviders = providersData?.data?.map((p) => p.id) || []

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Catalog Review</h1>
          <p className="text-muted-foreground">Review and validate model configurations after migration</p>
        </div>
        <Navigation />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Filter models to review specific configurations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Input
              placeholder="Search models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Capabilities</label>
            <div className="flex flex-wrap gap-2">
              {CAPABILITIES.map((capability) => (
                <Badge
                  key={capability}
                  variant={selectedCapabilities.includes(capability) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => {
                    setSelectedCapabilities((prev) =>
                      prev.includes(capability) ? prev.filter((c) => c !== capability) : [...prev, capability]
                    )
                  }}>
                  {capability.replace('_', ' ')}
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Providers</label>
            <div className="flex flex-wrap gap-2">
              {allProviders.map((provider) => (
                <Badge
                  key={provider}
                  variant={selectedProviders.includes(provider) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => {
                    setSelectedProviders((prev) =>
                      prev.includes(provider) ? prev.filter((p) => p !== provider) : [...prev, provider]
                    )
                  }}>
                  {provider}
                </Badge>
              ))}
            </div>
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
          <CardTitle>Models ({pagination.total})</CardTitle>
          <CardDescription>Review migrated model configurations</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">
              <div className="animate-pulse">Loading models...</div>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Capabilities</TableHead>
                    <TableHead>Context Window</TableHead>
                    <TableHead>Modalities</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {models.map((model) => (
                    <TableRow key={model.id}>
                      <TableCell className="font-mono text-sm">{model.id}</TableCell>
                      <TableCell>{model.name || model.id}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{model.owned_by}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {model.capabilities?.slice(0, 3).map((cap) => (
                            <Badge key={cap} variant="secondary" className="text-xs">
                              {cap.replace('_', ' ')}
                            </Badge>
                          ))}
                          {model.capabilities && model.capabilities.length > 3 && (
                            <Badge variant="secondary" className="text-xs">
                              +{model.capabilities.length - 3}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{model.context_window?.toLocaleString() || 'N/A'}</TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <div>In: {model.input_modalities?.join(', ') || 'N/A'}</div>
                          <div>Out: {model.output_modalities?.join(', ') || 'N/A'}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm" onClick={() => handleEdit(model)}>
                              Edit
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                            <DialogHeader>
                              <div className="flex items-center justify-between">
                                <div>
                                  <DialogTitle>Edit Model Configuration</DialogTitle>
                                  <DialogDescription>
                                    {editMode === 'form' ? 'Use the form below' : 'Edit JSON'} to modify {model.name || model.id}
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
                                <ModelEditForm
                                  model={model}
                                  onSave={handleSave}
                                  onCancel={() => setEditingModel(null)}
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
                                      onClick={() => setEditingModel(null)}
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Separator className="my-4" />

              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
                  {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} models
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
