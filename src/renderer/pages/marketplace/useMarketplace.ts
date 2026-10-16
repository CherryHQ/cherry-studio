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
import { skillInstallIdentity, subscriptionMemberSource } from '@shared/utils/skillSubscription'

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

export function useMarketplace(sourceId: string | null = null, active = true) {
  const { t, i18n } = useTranslation()
  const { cache, mutate } = useSWRConfig()
  const [sourceSummary, setSourceSummary] = useState<{ sourceId: string; skipped: number } | null>(null)
  const cached = useSWR(
    sourceId ? ['skill.subscription.cache', sourceId] : null,
    ([, id]) => ipcApi.request('skill.subscription.list', { sourceId: id }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  )
  const catalogKey = sourceId ? ['skill.subscription.catalog', sourceId] : 'skill.marketplace.list'
  const catalog = useSWR<MarketplaceSkill[]>(
    active ? catalogKey : null,
    async () => {
      if (!sourceId) return loadMarketplaceSkills()
      const snapshot = await ipcApi.request('skill.subscription.refresh', { sourceId })
      setSourceSummary({ sourceId, skipped: snapshot.skipped })
      return snapshot.items
    },
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      fallbackData: cached.data?.items
    }
  )
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
          .filter((skill) => skill.source === 'marketplace')
          .flatMap((skill) => (skill.sourceUrl ? [[skillInstallIdentity(skill.sourceUrl), skill] as const] : []))
      ),
    [installed.skills]
  )
  const installedMembers = useCallback(
    (skill: MarketplaceSkill) => {
      if (skill.subscription) {
        const members = skill.membersKnown
          ? skill.members
          : [...installedSources.values()].flatMap((local) => {
              if (!local.sourceUrl?.startsWith(skill.subscription!.url + '#')) return []
              try {
                return [{ path: decodeURIComponent(new URL(local.sourceUrl).hash.slice(1)), name: local.name }]
              } catch {
                return []
              }
            })
        return members.flatMap((member) => {
          const local = installedSources.get(skillInstallIdentity(subscriptionMemberSource(skill, member.path)))
          return local ? [{ ...member, skillId: local.id }] : []
        })
      }
      return (
        skill.membersKnown
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
      })
    },
    [installedSources]
  )
  const installedCount = useCallback((skill: MarketplaceSkill) => installedMembers(skill).length, [installedMembers])
  // Root provenance identifies older single-skill installs without downloading again.
  // Legacy collections need a ZIP manifest before their completeness can be known.
  const items = useMemo(
    () =>
      catalog.data?.map((skill) => {
        const local = skill.subscription ? undefined : installedSources.get(marketplaceSkillSource(skill.id, ''))
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
          const result = skill.subscription
            ? await ipcApi.request('skill.subscription.install', {
                sourceId: skill.subscription.sourceId,
                itemId: skill.id
              })
            : await ipcApi.request('skill.marketplace.install', { id: skill.id })
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
              skill.subscription
                ? ['skill.subscription.detail', skill.subscription.sourceId, skill.id]
                : ['skill.marketplace.detail', skill.id],
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
    curatedCount: (cache.get('skill.marketplace.list')?.data as MarketplaceSkill[] | undefined)?.length ?? null,
    catalog: {
      ...catalog,
      data: items,
      isLoading: !items && (catalog.isLoading || cached.isLoading),
      error: catalog.error ?? cached.error
    },
    skipped: sourceSummary?.sourceId === sourceId ? sourceSummary.skipped : (cached.data?.skipped ?? 0),
    installed,
    installedCount,
    installedMembers,
    mutating,
    failures,
    mutateSkill
  }
}
