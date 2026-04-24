// TODO(library-routing): `onEditItem` and `onCreateNew` are temporary stubs that navigate to the
//               legacy `/app/agents` list page. They should be wired to the V2 resource library
//               once that flow ships (landing branch: `feat/v2/resource-library-agents`,
//               upstream PR #14442):
//                 - Edit → library agent detail / config page scoped to the selected id
//                 - Create → library "new agent" entry flow
//               Update this file together with the corresponding AssistantSelectorV2 TODO when the
//               library routes are finalized.
// TODO(tags): wire tag filter chips once the resource library PR (feat/v2/resource-library-agents,
//             upstream PR #14442) is merged AND the /agents endpoint below exposes a parallel
//             tag association. The resource library PR adds the Assistant↔Tag model; agents are
//             expected to follow the same shape once their DataApi lands.
// TODO(data-layer): depends on a follow-up PR to add the /agents DataApi endpoint (handler in
//                   src/main/data/api/handlers + schema in packages/shared/data/api/schemas).
//                   As of today no such handler is registered, so the selector renders an
//                   empty-shell list. Once that PR merges, switch to `useQuery('/agents', ...)`
//                   — mirrors the AssistantSelectorV2 wiring. This PR is an independent
//                   prerequisite from the resource library PR referenced above; both must land
//                   before this selector reaches parity with AssistantSelectorV2.

import { usePreference } from '@renderer/data/hooks/usePreference'
import { useNavigate } from '@tanstack/react-router'
import { Bot } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseSelectorV2, type BaseSelectorV2Item, type BaseSelectorV2SortOption } from './BaseSelectorV2'

type AgentRow = BaseSelectorV2Item & { _createdAt: number }

type Props = {
  trigger: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Agent selector is single-select by contract — no `multi` variant exists. */
  value: string | null
  onChange: (value: string | null) => void
}

// Empty shell until /agents DataApi endpoint is registered. See TODO(data-layer) above.
const EMPTY_ITEMS: AgentRow[] = []

export function AgentSelectorV2({ trigger, open, onOpenChange, value, onChange }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [pinnedIds, setPinnedIds] = usePreference('agent.pinned_ids')

  const items: AgentRow[] = EMPTY_ITEMS

  const sortOptions = useMemo<BaseSelectorV2SortOption<AgentRow>[]>(
    () => [
      { id: 'desc', label: t('selector.common.sort.desc'), comparator: (a, b) => b._createdAt - a._createdAt },
      { id: 'asc', label: t('selector.common.sort.asc'), comparator: (a, b) => a._createdAt - b._createdAt }
    ],
    [t]
  )

  return (
    <BaseSelectorV2
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      items={items}
      renderFallbackIcon={() => <Bot className="size-4 text-muted-foreground/70" />}
      value={value}
      onChange={onChange}
      sortOptions={sortOptions}
      defaultSortId="desc"
      pinnedIds={pinnedIds ?? []}
      onPinnedIdsChange={setPinnedIds}
      onEditItem={() => {
        // TODO(library-routing): replace with library agent edit route once `feat/v2/resource-library-agents` ships.
        void navigate({ to: '/app/agents' })
      }}
      onCreateNew={() => {
        // TODO(library-routing): replace with library agent create route once `feat/v2/resource-library-agents` ships.
        void navigate({ to: '/app/agents' })
      }}
      loading={false}
      labels={{
        searchPlaceholder: t('selector.agent.search_placeholder'),
        sortLabel: t('selector.common.sort_label'),
        edit: t('selector.common.edit'),
        pin: t('selector.common.pin'),
        unpin: t('selector.common.unpin'),
        createNew: t('selector.agent.create_new'),
        emptyText: t('selector.agent.empty_text'),
        pinnedTitle: t('selector.common.pinned_title')
      }}
    />
  )
}
