import { Button } from '@renderer/components/ui/button'
import React from 'react'

/**
 * Demo component to test Tailwind CSS and shadcn/ui integration
 * @description Displays various button variants and Tailwind utilities to verify setup
 * @returns JSX element with demo buttons and styling
 * @since 1.0.0
 * @author v0-AI-Assistant
 * @lastModified 2025-01-27 by v0-AI-Assistant - Initial implementation for Phase 1 testing
 */
export function TailwindDemo() {
  return (
    <div className="p-6 space-y-4 bg-background text-foreground">
      <h2 className="text-2xl font-bold text-primary">Tailwind + shadcn/ui Demo</h2>

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Testing button variants:</p>
        <div className="flex gap-2 flex-wrap">
          <Button variant="default">Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Testing button sizes:</p>
        <div className="flex gap-2 items-center">
          <Button size="sm">Small</Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
          <Button size="icon">🎨</Button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Testing Tailwind utilities:</p>
        <div className="grid grid-cols-2 gap-4 p-4 border rounded-lg">
          <div className="bg-primary/10 p-3 rounded text-center">Primary Background</div>
          <div className="bg-secondary p-3 rounded text-center">Secondary Background</div>
          <div className="bg-muted p-3 rounded text-center">Muted Background</div>
          <div className="bg-accent p-3 rounded text-center">Accent Background</div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Testing existing CSS variables:</p>
        <div className="grid grid-cols-2 gap-4 p-4 border rounded-lg">
          <div style={{ backgroundColor: 'var(--color-primary)', color: 'white' }} className="p-3 rounded text-center">
            CSS Variable Primary
          </div>
          <div style={{ backgroundColor: 'var(--color-background-soft)' }} className="p-3 rounded text-center">
            CSS Variable Background Soft
          </div>
        </div>
      </div>
    </div>
  )
}
