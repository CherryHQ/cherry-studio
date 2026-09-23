import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR, { useSWRConfig } from 'swr'

import { loggerService } from '@logger'
import { useInstalledSkills, useInvalidateSkills, useReconcileSkillsOnOpen } from '@renderer/hooks/useSkills'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { MarketplaceInstallResult, MarketplaceSkill, MarketplaceSkillDetail } from '@shared/types/skillMarketplace'
import {
  localizeMarketplaceText,
  marketplaceSkillNamespace,
  marketplaceSkillSource
} from '@shared/utils/cherrySkillMarketplace'

const logger = loggerService.withContext('Marketplace')

export async function loadMarketplaceSkills(): Promise<MarketplaceSkill[]> {
  const items = new Map<string, MarketplaceSkill>()
  const limit = 100
  let offset = 0
  while (true) {
    const page = await ipcApi.request('skill.marketplace.list', { offset, limit })
    if (page.pagination.offset !== offset || (page.pagination.hasMore && !page.items.length)) {
      throw new Error('Invalid CherryIN pagination')
    }
    for (const item of page.items) items.set(item.id, item)
    if (!page.pagination.hasMore) break
    offset += page.pagination.limit
  }
  return [...items.values()]
}

export function useMarketplace() {
  const { t, i18n } = useTranslation()
  const { mutate } = useSWRConfig()
  const catalog = useSWR('skill.marketplace.list', loadMarketplaceSkills, {
    revalidateOnFocus: false,
    shouldRetryOnError: false
  })
  const installed = useInstalledSkills()
  const mutateCatalog = catalog.mutate
  useReconcileSkillsOnOpen(true)
  const invalidate = useInvalidateSkills()
  const pending = useRef(new Set<string>())
  const [mutating, setMutating] = useState<ReadonlySet<string>>(() => new Set())
  const [failures, setFailures] = useState<Record<string, MarketplaceInstallResult['failed']>>({})
  const installedSources = useMemo(
    () =>
      new Map(
        installed.skills
          .filter((skill) => skill.source === 'marketplace' && skill.namespace?.startsWith('cherryin:'))
          .flatMap((skill) => (skill.sourceUrl ? [[skill.sourceUrl, skill] as const] : []))
      ),
    [installed.skills]
  )
  const installedMembers = useCallback(
    (skill: MarketplaceSkill) =>
      (skill.membersKnown
        ? skill.members
        : [...installedSources.values()].flatMap((local) => {
            if (local.namespace !== marketplaceSkillNamespace(skill.id) || !local.sourceUrl) return []
            try {
              const path = decodeURIComponent(new URL(local.sourceUrl).hash.slice(1))
              return [{ path, name: local.name }]
            } catch {
              return []
            }
          })
      ).flatMap((member) => {
        const local = installedSources.get(marketplaceSkillSource(skill.id, member.path))
        return local?.namespace === marketplaceSkillNamespace(skill.id) ? [{ ...member, skillId: local.id }] : []
      }),
    [installedSources]
  )
  const installedCount = useCallback((skill: MarketplaceSkill) => installedMembers(skill).length, [installedMembers])
  // Root provenance identifies older single-skill installs without downloading again.
  // Legacy collections need a ZIP manifest before their completeness can be known.
  const items = useMemo(
    () =>
      catalog.data?.map((skill) => {
        const local = installedSources.get(marketplaceSkillSource(skill.id, ''))
        return !skill.membersKnown && local?.namespace === marketplaceSkillNamespace(skill.id)
          ? { ...skill, membersKnown: true, isCollection: false, members: [{ path: '', name: local.name }] }
          : skill
      }),
    [catalog.data, installedSources]
  )

  const mutateSkill = useCallback(
    async (skill: MarketplaceSkill, action: 'install' | 'uninstall') => {
      if (pending.current.has(skill.id)) return false
      pending.current.add(skill.id)
      setMutating(new Set(pending.current))
      setFailures((current) => ({ ...current, [skill.id]: [] }))
      const name = localizeMarketplaceText(skill.name, i18n.language)
      try {
        if (action === 'install') {
          const result = await ipcApi.request('skill.marketplace.install', { id: skill.id })
          const contents = {
            members: result.members,
            membersKnown: true,
            isCollection: result.members.some((m) => m.path !== '')
          }
          await Promise.all([
            mutateCatalog((items) => items?.map((item) => (item.id === skill.id ? { ...item, ...contents } : item)), {
              revalidate: false
            }),
            mutate<MarketplaceSkillDetail>(
              ['skill.marketplace.detail', skill.id],
              (item) => (item ? { ...item, ...contents } : item),
              { revalidate: false }
            )
          ])
          setFailures((current) => ({ ...current, [skill.id]: result.failed }))
          if (result.failed.length) {
            toast.error(
              t('marketplace.partial_install', {
                installed: result.installed.length + result.alreadyInstalled.length,
                total: result.members.length
              })
            )
          } else {
            toast.success(t('settings.skills.installSuccess', { name }))
          }
          return result.failed.length === 0
        }

        const failed: MarketplaceInstallResult['failed'] = []
        for (const member of installedMembers(skill)) {
          try {
            const result = await ipcApi.request('skill.uninstall', { skillId: member.skillId })
            if (!result.success) throw result.error
          } catch (error) {
            failed.push({
              path: member.path,
              name: member.name,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }
        setFailures((current) => ({ ...current, [skill.id]: failed }))
        if (failed.length) {
          logger.warn('Marketplace uninstall failed', { id: skill.id, failed })
          toast.error(t('common.delete_failed'))
        } else {
          toast.success(t('common.success'))
        }
        return failed.length === 0
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setFailures((current) => ({ ...current, [skill.id]: [{ path: '', name, error: message }] }))
        logger.warn('Marketplace mutation failed', { id: skill.id, action, error: message })
        toast.error(
          `${t(action === 'install' ? 'settings.skills.installFailed' : 'common.delete_failed', { name })}: ${message}`
        )
        return false
      } finally {
        try {
          await invalidate()
        } catch (error) {
          logger.warn('Failed to refresh installed skills', { error })
        }
        pending.current.delete(skill.id)
        setMutating(new Set(pending.current))
      }
    },
    [mutateCatalog, i18n.language, installedMembers, invalidate, mutate, t]
  )

  return {
    catalog: { ...catalog, data: items },
    installed,
    installedCount,
    installedMembers,
    mutating,
    failures,
    mutateSkill
  }
}
