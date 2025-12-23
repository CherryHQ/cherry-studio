'use client'

import { useState } from 'react'

import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Textarea } from './ui/textarea'
import type { Provider } from '@/lib/catalog-types'
import { EndpointTypeSchema, ApiFormatSchema, AuthenticationSchema } from '../../src/schemas/provider'

// Extract enum values from schemas
const ENDPOINT_TYPES = EndpointTypeSchema.options
const API_FORMATS = ApiFormatSchema.options
const AUTHENTICATION_TYPES = AuthenticationSchema.options

interface ProviderEditFormProps {
  provider: Provider
  onSave: (provider: Partial<Provider>) => void
  onCancel: () => void
  isSaving?: boolean
}

export function ProviderEditForm({ provider, onSave, onCancel, isSaving }: ProviderEditFormProps) {
  const [formData, setFormData] = useState({
    id: provider.id,
    name: provider.name,
    description: provider.description || '',
    authentication: provider.authentication || 'API_KEY',
    supported_endpoints: provider.supported_endpoints || ['CHAT_COMPLETIONS'],
    formats: provider.formats || [],
    deprecated: provider.deprecated || false,
    documentation: provider.documentation || '',
    website: provider.website || ''
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const updatedProvider: Partial<Provider> = {
      name: formData.name,
      description: formData.description || undefined,
      authentication: formData.authentication as any,
      supported_endpoints: formData.supported_endpoints,
      formats: formData.formats,
      deprecated: formData.deprecated,
      documentation: formData.documentation || undefined,
      website: formData.website || undefined
    }

    onSave(updatedProvider)
  }

  const toggleEndpoint = (endpoint: string) => {
    setFormData((prev) => ({
      ...prev,
      supported_endpoints: prev.supported_endpoints.includes(endpoint)
        ? prev.supported_endpoints.filter((e) => e !== endpoint)
        : [...prev.supported_endpoints, endpoint]
    }))
  }

  const addFormat = () => {
    setFormData((prev) => ({
      ...prev,
      formats: [
        ...prev.formats,
        {
          format: 'OPENAI' as any,
          base_url: '',
          default: prev.formats.length === 0
        }
      ]
    }))
  }

  const removeFormat = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      formats: prev.formats.filter((_, i) => i !== index)
    }))
  }

  const updateFormat = (index: number, field: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      formats: prev.formats.map((f, i) =>
        i === index
          ? {
              ...f,
              [field]: value
            }
          : f
      )
    }))
  }

  const setDefaultFormat = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      formats: prev.formats.map((f, i) => ({
        ...f,
        default: i === index
      }))
    }))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-h-[70vh] overflow-y-auto px-1">
      {/* Provider ID - Read only */}
      <div className="space-y-2">
        <Label htmlFor="id">Provider ID</Label>
        <Input id="id" value={formData.id} disabled className="font-mono" />
      </div>

      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="name">Name *</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
          required
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
          rows={3}
          placeholder="Provider description..."
        />
      </div>

      {/* Authentication */}
      <div className="space-y-2">
        <Label htmlFor="authentication">Authentication</Label>
        <Select
          value={formData.authentication}
          onValueChange={(value) => setFormData((prev) => ({ ...prev, authentication: value }))}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AUTHENTICATION_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {type.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Supported Endpoints */}
      <div className="space-y-2">
        <Label>Supported Endpoints</Label>
        <div className="flex flex-wrap gap-2 p-3 rounded-md min-h-[60px] bg-muted/10">
          {ENDPOINT_TYPES.map((endpoint) => (
            <Badge
              key={endpoint}
              variant={formData.supported_endpoints.includes(endpoint) ? 'default' : 'secondary'}
              className={`cursor-pointer transition-all ${
                formData.supported_endpoints.includes(endpoint)
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 border-2 border-primary'
                  : 'bg-secondary/50 text-secondary-foreground hover:bg-secondary/80 border-2 border-transparent'
              }`}
              onClick={() => toggleEndpoint(endpoint)}>
              {endpoint.replace(/_/g, ' ')}
            </Badge>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">Click to toggle supported endpoints</p>
      </div>

      {/* API Formats */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>API Formats</Label>
          <Button type="button" variant="outline" size="sm" onClick={addFormat}>
            + Add Format
          </Button>
        </div>

        {formData.formats.map((format, index) => (
          <div key={index} className="p-4 border rounded-md space-y-3 bg-muted/50">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Format {index + 1}</span>
              <div className="flex items-center gap-2">
                {!format.default && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDefaultFormat(index)}
                    className="text-xs">
                    Set Default
                  </Button>
                )}
                {format.default && <Badge variant="secondary">Default</Badge>}
                <Button type="button" variant="ghost" size="sm" onClick={() => removeFormat(index)}>
                  ✕
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">Format</Label>
                <Select value={format.format} onValueChange={(value) => updateFormat(index, 'format', value)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {API_FORMATS.map((fmt) => (
                      <SelectItem key={fmt} value={fmt}>
                        {fmt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Base URL</Label>
                <Input
                  value={format.base_url}
                  onChange={(e) => updateFormat(index, 'base_url', e.target.value)}
                  placeholder="https://api.example.com"
                  className="h-9"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Documentation & Website */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="documentation">Documentation URL</Label>
          <Input
            id="documentation"
            type="url"
            value={formData.documentation}
            onChange={(e) => setFormData((prev) => ({ ...prev, documentation: e.target.value }))}
            placeholder="https://docs.example.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="website">Website URL</Label>
          <Input
            id="website"
            type="url"
            value={formData.website}
            onChange={(e) => setFormData((prev) => ({ ...prev, website: e.target.value }))}
            placeholder="https://example.com"
          />
        </div>
      </div>

      {/* Deprecated */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="deprecated"
          checked={formData.deprecated}
          onChange={(e) => setFormData((prev) => ({ ...prev, deprecated: e.target.checked }))}
          className="w-4 h-4"
        />
        <Label htmlFor="deprecated" className="cursor-pointer">
          Mark as deprecated
        </Label>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 sticky bottom-0 bg-background pt-4 border-t">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSaving}
          className="min-w-[100px]">
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isSaving}
          className="min-w-[140px] bg-primary hover:bg-primary/90">
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </form>
  )
}
