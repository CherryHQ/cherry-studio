'use client'

import { useState } from 'react'

import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import type { Model } from '@/lib/catalog-types'

const CAPABILITIES = [
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

const MODALITIES = ['TEXT', 'VISION', 'AUDIO', 'VIDEO', 'VECTOR'] as const

interface ModelEditFormProps {
  model: Model
  onSave: (model: Partial<Model>) => void
  onCancel: () => void
  isSaving?: boolean
}

export function ModelEditForm({ model, onSave, onCancel, isSaving }: ModelEditFormProps) {
  const [formData, setFormData] = useState({
    id: model.id,
    description: model.description || '',
    capabilities: model.capabilities || [],
    input_modalities: model.input_modalities || [],
    output_modalities: model.output_modalities || ['TEXT'],
    context_window: model.context_window?.toString() || '',
    max_output_tokens: model.max_output_tokens?.toString() || ''
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const updatedModel: Partial<Model> = {
      description: formData.description || undefined,
      capabilities: formData.capabilities.length > 0 ? formData.capabilities : undefined,
      input_modalities: formData.input_modalities.length > 0 ? formData.input_modalities : undefined,
      output_modalities: formData.output_modalities.length > 0 ? formData.output_modalities : ['TEXT'],
      context_window: formData.context_window ? parseInt(formData.context_window) : undefined,
      max_output_tokens: formData.max_output_tokens ? parseInt(formData.max_output_tokens) : undefined
    }

    onSave(updatedModel)
  }

  const toggleCapability = (capability: string) => {
    setFormData((prev) => ({
      ...prev,
      capabilities: prev.capabilities.includes(capability)
        ? prev.capabilities.filter((c) => c !== capability)
        : [...prev.capabilities, capability]
    }))
  }

  const toggleModality = (modality: string, type: 'input' | 'output') => {
    const field = type === 'input' ? 'input_modalities' : 'output_modalities'
    setFormData((prev) => ({
      ...prev,
      [field]: prev[field].includes(modality)
        ? prev[field].filter((m) => m !== modality)
        : [...prev[field], modality]
    }))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Model ID - Read only */}
      <div className="space-y-2">
        <Label htmlFor="id">Model ID</Label>
        <Input id="id" value={formData.id} disabled className="font-mono" />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
          rows={4}
          placeholder="Model description..."
        />
      </div>

      {/* Capabilities */}
      <div className="space-y-2">
        <Label>Capabilities</Label>
        <div className="flex flex-wrap gap-2 p-3 rounded-md min-h-[60px] bg-muted/10">
          {CAPABILITIES.map((capability) => (
            <Badge
              key={capability}
              variant={formData.capabilities.includes(capability) ? 'default' : 'secondary'}
              className={`cursor-pointer transition-all ${
                formData.capabilities.includes(capability)
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 border-2 border-primary'
                  : 'bg-secondary/50 text-secondary-foreground hover:bg-secondary/80 border-2 border-transparent'
              }`}
              onClick={() => toggleCapability(capability)}>
              {capability.replace(/_/g, ' ')}
            </Badge>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">Click to toggle capabilities</p>
      </div>

      {/* Input Modalities */}
      <div className="space-y-2">
        <Label>Input Modalities</Label>
        <div className="flex flex-wrap gap-2 p-3 rounded-md bg-muted/10">
          {MODALITIES.map((modality) => (
            <Badge
              key={modality}
              variant={formData.input_modalities.includes(modality) ? 'default' : 'secondary'}
              className={`cursor-pointer transition-all ${
                formData.input_modalities.includes(modality)
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 border-2 border-primary'
                  : 'bg-secondary/50 text-secondary-foreground hover:bg-secondary/80 border-2 border-transparent'
              }`}
              onClick={() => toggleModality(modality, 'input')}>
              {modality}
            </Badge>
          ))}
        </div>
      </div>

      {/* Output Modalities */}
      <div className="space-y-2">
        <Label>Output Modalities</Label>
        <div className="flex flex-wrap gap-2 p-3 rounded-md bg-muted/10">
          {MODALITIES.map((modality) => (
            <Badge
              key={modality}
              variant={formData.output_modalities.includes(modality) ? 'default' : 'secondary'}
              className={`cursor-pointer transition-all ${
                formData.output_modalities.includes(modality)
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 border-2 border-primary'
                  : 'bg-secondary/50 text-secondary-foreground hover:bg-secondary/80 border-2 border-transparent'
              }`}
              onClick={() => toggleModality(modality, 'output')}>
              {modality}
            </Badge>
          ))}
        </div>
      </div>

      {/* Numeric Fields */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="context_window">Context Window</Label>
          <Input
            id="context_window"
            type="number"
            value={formData.context_window}
            onChange={(e) => setFormData((prev) => ({ ...prev, context_window: e.target.value }))}
            placeholder="e.g., 128000"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="max_output_tokens">Max Output Tokens</Label>
          <Input
            id="max_output_tokens"
            type="number"
            value={formData.max_output_tokens}
            onChange={(e) => setFormData((prev) => ({ ...prev, max_output_tokens: e.target.value }))}
            placeholder="e.g., 8192"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
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
