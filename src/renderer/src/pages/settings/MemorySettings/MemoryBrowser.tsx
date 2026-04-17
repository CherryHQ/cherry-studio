/**
 * MemoryBrowser — browse, search, and delete stored memories.
 * When Hindsight is active and reflect is enabled, also shows a Reflect panel.
 */

import { Button, Input, Separator } from '@cherrystudio/ui'
import { useMemoryDelete, useMemoryList } from '@renderer/hooks/useMemory'
import { useMemoryCapabilities } from '@renderer/hooks/useMemoryCapabilities'
import { memoryService } from '@renderer/services/MemoryService'
import type { ReflectResult } from '@shared/memory'
import { Loader2, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function MemoryBrowser() {
  const { t } = useTranslation()
  const capabilities = useMemoryCapabilities()
  const { items, loading, refetch } = useMemoryList()
  const { deleteMemory, deleteAll, loading: deleting } = useMemoryDelete()

  const [searchQuery, setSearchQuery] = useState('')
  const [reflectQuery, setReflectQuery] = useState('')
  const [reflectResult, setReflectResult] = useState<ReflectResult | null>(null)
  const [reflecting, setReflecting] = useState(false)

  const handleDelete = async (id: string) => {
    await deleteMemory(id)
    refetch()
  }

  const handleDeleteAll = async () => {
    if (!window.confirm(t('settings.memory.browser.confirm_delete_all', 'Delete all memories? This cannot be undone.')))
      return
    await deleteAll()
    refetch()
  }

  const handleReflect = async () => {
    if (!reflectQuery.trim()) return
    setReflecting(true)
    try {
      const result = await memoryService.reflect(reflectQuery)
      setReflectResult(result)
    } catch {
      setReflectResult({
        content: t('settings.memory.browser.reflect_error', 'Reflect failed. Check server connection.')
      })
    } finally {
      setReflecting(false)
    }
  }

  const filteredItems = searchQuery.trim()
    ? items.filter((item) => item.memory.toLowerCase().includes(searchQuery.toLowerCase()))
    : items

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute top-2.5 left-2 h-4 w-4 text-[var(--color-text-3)]" />
          <Input
            className="pl-8"
            placeholder={t('settings.memory.browser.search_placeholder', 'Filter memories…')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
          {t('settings.memory.browser.refresh', 'Refresh')}
        </Button>
        <Button variant="outline" size="sm" onClick={handleDeleteAll} disabled={deleting || items.length === 0}>
          {t('settings.memory.browser.delete_all', 'Delete All')}
        </Button>
      </div>

      {/* Memory list */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-[var(--color-text-3)]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t('settings.memory.browser.loading', 'Loading memories…')}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="py-8 text-center text-[var(--color-text-3)] text-sm">
          {t('settings.memory.browser.empty', 'No memories stored yet.')}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="flex items-start justify-between gap-3 rounded-md border border-[var(--color-border)] p-3 text-sm">
              <div className="flex-1">
                <p className="text-[var(--color-text-1)] leading-relaxed">{item.memory}</p>
                {item.createdAt && (
                  <p className="mt-1 text-[var(--color-text-3)] text-xs">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-[var(--color-text-3)] hover:text-red-500"
                onClick={() => handleDelete(item.id)}
                disabled={deleting}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Reflect panel — only when Hindsight + reflect enabled */}
      {capabilities?.supportsReflect && (
        <>
          <Separator />
          <div className="space-y-2">
            <p className="font-medium text-[var(--color-text-1)] text-sm">
              {t('settings.memory.browser.reflect_title', 'Reflect')}
            </p>
            <p className="text-[var(--color-text-3)] text-xs">
              {t(
                'settings.memory.browser.reflect_description',
                'Ask Hindsight to analyse and synthesise insights from stored memories.'
              )}
            </p>
            <div className="flex gap-2">
              <Input
                className="flex-1"
                placeholder={t('settings.memory.browser.reflect_placeholder', 'e.g. What are my key preferences?')}
                value={reflectQuery}
                onChange={(e) => setReflectQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleReflect()}
              />
              <Button onClick={handleReflect} disabled={reflecting || !reflectQuery.trim()} size="sm">
                {reflecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t('settings.memory.browser.reflect_btn', 'Reflect')
                )}
              </Button>
            </div>
            {reflectResult && (
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-background-soft)] p-3 text-[var(--color-text-1)] text-sm leading-relaxed">
                {reflectResult.content}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
