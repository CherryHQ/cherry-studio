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

export function useSkillLibraryTags() {
  const { t } = useTranslation()
  const [value, setValue] = usePreference('ui.marketplace.skill_tags', { optimistic: false })
  const busy = useRef(false)
  const [saving, setSaving] = useState(false)
  const tags = useMemo(
    () => [
      ...Object.entries(BUILTIN_TAGS)
        .map(([id, key], color) => ({ id, color, name: t(key) }))
        .filter((tag) => !value.removedDefaults?.includes(tag.id)),
      ...value.custom
    ],
    [t, value.custom, value.removedDefaults]
  )
  const save = async (next: SkillLibraryTags) => {
    if (busy.current) return false
    busy.current = true
    setSaving(true)
    try {
      await setValue(next)
      return true
    } catch {
      toast.error(t('common.save_failed'))
      return false
    } finally {
      busy.current = false
      setSaving(false)
    }
  }
  const toggle = (skillId: string, tagId: string) => {
    const current = value.assignments[skillId] ?? []
    return save({
      ...value,
      assignments: {
        ...value.assignments,
        [skillId]: current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]
      }
    })
  }
  const create = async (name: string, skillId?: string) => {
    const trimmed = name.trim()
    if (!trimmed) return false
    const existing = tags.find((tag) => tag.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())
    if (existing) {
      if (skillId && !value.assignments[skillId]?.includes(existing.id)) return toggle(skillId, existing.id)
      return true
    }
    const id = crypto.randomUUID()
    return save({
      ...value,
      custom: [...value.custom, { id, name: trimmed, color: tags.length % TAG_COLORS.length }],
      assignments: skillId
        ? { ...value.assignments, [skillId]: [...(value.assignments[skillId] ?? []), id] }
        : value.assignments
    })
  }
  const remove = (tagId: string) =>
    save({
      ...value,
      custom: value.custom.filter((tag) => tag.id !== tagId),
      removedDefaults: Object.hasOwn(BUILTIN_TAGS, tagId)
        ? [...new Set([...(value.removedDefaults ?? []), tagId])]
        : value.removedDefaults,
      assignments: Object.fromEntries(
        Object.entries(value.assignments)
          .map(([skillId, ids]) => [skillId, ids.filter((id) => id !== tagId)] as const)
          .filter(([, ids]) => ids.length > 0)
      )
    })
  return { tags, assignments: value.assignments, saving, toggle, create, remove }
}

export type SkillLibraryTagManager = ReturnType<typeof useSkillLibraryTags>
