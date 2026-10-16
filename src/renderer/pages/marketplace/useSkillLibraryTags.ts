import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePreference } from '@data/hooks/usePreference'
import { toast } from '@renderer/services/toast'
import type { SkillLibraryTags } from '@shared/data/preference/preferenceTypes'

const BUILTIN_TAGS = {
  coding: 'marketplace.tags.coding',
  creative: 'marketplace.tags.creative',
  conversation: 'marketplace.tags.conversation',
  translation: 'marketplace.tags.translation',
  analysis: 'marketplace.tags.analysis',
  productivity: 'marketplace.tags.productivity',
  general: 'marketplace.tags.general',
  writing: 'marketplace.tags.writing'
}
export const TAG_COLORS = [
  'bg-blue-500',
  'bg-pink-500',
  'bg-cyan-500',
  'bg-amber-500',
  'bg-red-500',
  'bg-violet-500',
  'bg-gray-400',
  'bg-emerald-500'
]

function getTags(value: SkillLibraryTags, translate: (key: string) => string) {
  return [
    ...Object.entries(BUILTIN_TAGS)
      .map(([id, key], color) => ({ id, color, name: translate(key) }))
      .filter((tag) => !value.removedDefaults?.includes(tag.id)),
    ...value.custom
  ]
}

export function useSkillLibraryTags() {
  const { t } = useTranslation()
  const [value, setValue] = usePreference('ui.marketplace.skill_tags', { optimistic: false })
  const latest = useRef(value)
  latest.current = value
  const queue = useRef(Promise.resolve(true))
  const [saving, setSaving] = useState(false)
  const tags = useMemo(() => getTags(value, t), [t, value])
  const save = (update: (current: SkillLibraryTags) => SkillLibraryTags | undefined) => {
    setSaving(true)
    const task = queue.current.then(async () => {
      try {
        const next = update(latest.current)
        if (next) {
          await setValue(next)
          latest.current = next
        }
        return true
      } catch {
        toast.error(t('common.save_failed'))
        return false
      } finally {
        if (queue.current === task) setSaving(false)
      }
    })
    queue.current = task
    return task
  }
  const toggle = (resourceKey: string, tagId: string) =>
    save((current) => {
      const ids = current.assignments[resourceKey] ?? []
      return {
        ...current,
        assignments: {
          ...current.assignments,
          [resourceKey]: ids.includes(tagId) ? ids.filter((id) => id !== tagId) : [...ids, tagId]
        }
      }
    })
  const create = async (name: string, resourceKey?: string) => {
    const trimmed = name.trim()
    if (!trimmed) return false
    return save((current) => {
      const currentTags = getTags(current, t)
      const existing = currentTags.find((tag) => tag.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())
      if (existing && (!resourceKey || current.assignments[resourceKey]?.includes(existing.id))) return undefined
      const id = existing?.id ?? crypto.randomUUID()
      return {
        ...current,
        custom: existing
          ? current.custom
          : [...current.custom, { id, name: trimmed, color: currentTags.length % TAG_COLORS.length }],
        assignments: resourceKey
          ? { ...current.assignments, [resourceKey]: [...(current.assignments[resourceKey] ?? []), id] }
          : current.assignments
      }
    })
  }
  const remove = (tagId: string) =>
    save((current) => ({
      ...current,
      custom: current.custom.filter((tag) => tag.id !== tagId),
      removedDefaults: Object.hasOwn(BUILTIN_TAGS, tagId)
        ? [...new Set([...(current.removedDefaults ?? []), tagId])]
        : current.removedDefaults,
      assignments: Object.fromEntries(
        Object.entries(current.assignments)
          .map(([resourceKey, ids]) => [resourceKey, ids.filter((id) => id !== tagId)] as const)
          .filter(([, ids]) => ids.length > 0)
      )
    }))
  const copy = (sourceKey: string, targetKey: string) =>
    save((current) => {
      const ids = current.assignments[sourceKey]
      return ids?.length ? { ...current, assignments: { ...current.assignments, [targetKey]: [...ids] } } : undefined
    })
  return { tags, assignments: value.assignments, saving, toggle, create, remove, copy }
}

export type SkillLibraryTagManager = ReturnType<typeof useSkillLibraryTags>
