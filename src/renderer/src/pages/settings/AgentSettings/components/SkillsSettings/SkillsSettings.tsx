import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import { TopView } from '@renderer/components/TopView'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import type { InstalledSkill, LocalSkill } from '@types'
import { Button, Card, type CardProps, Empty, Spin, Switch, Tag } from 'antd'
import { Plus, Puzzle } from 'lucide-react'
import { type FC, memo, useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type AgentOrSessionSettingsProps, SettingsContainer, SettingsItem, SettingsTitle } from '../../shared'

const cardStyles: CardProps['styles'] = {
  header: {
    paddingLeft: '12px',
    paddingRight: '12px',
    borderBottom: 'none'
  },
  body: {
    paddingLeft: '12px',
    paddingRight: '12px',
    paddingTop: '0px',
    paddingBottom: '0px'
  }
}

const searchBarStyle = { borderRadius: 20 }
const emptyIconStyle = { opacity: 0.3 }

// rerender-memo: Extract card into memo component so toggling one skill
// doesn't re-render every other skill card in the list.
const SkillCard = memo<{
  skill: InstalledSkill
  toggling: boolean
  onToggle: (skill: InstalledSkill, checked: boolean) => void
}>(({ skill, toggling, onToggle }) => {
  const { t } = useTranslation()
  const handleChange = useEffectEvent((checked: boolean) => onToggle(skill, checked))

  return (
    <Card
      className="border border-default-200"
      title={
        <div className="flex items-start justify-between gap-3 py-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate font-medium text-sm">{skill.name}</span>
            {skill.description ? (
              <span className="line-clamp-2 whitespace-normal text-foreground-500 text-xs">{skill.description}</span>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {skill.author && <Tag>{skill.author}</Tag>}
              <Tag color={skill.source === 'builtin' ? 'green' : 'blue'}>
                {skill.source === 'builtin' ? t('agent.settings.skills.builtin', 'Built-in') : skill.source}
              </Tag>
            </div>
          </div>
          {skill.source !== 'builtin' && (
            <Switch checked={skill.isEnabled} loading={toggling} onChange={handleChange} size="small" />
          )}
        </div>
      }
      styles={cardStyles}
    />
  )
})
SkillCard.displayName = 'SkillCard'

const LocalSkillCard = memo<{ plugin: LocalSkill }>(({ plugin }) => (
  <Card
    className="border border-default-200"
    title={
      <div className="flex items-start justify-between gap-3 py-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-medium text-sm">{plugin.name}</span>
          {plugin.description ? (
            <span className="line-clamp-2 whitespace-normal text-foreground-500 text-xs">{plugin.description}</span>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Tag color="default">local</Tag>
          </div>
        </div>
      </div>
    }
    styles={cardStyles}
  />
))
LocalSkillCard.displayName = 'LocalSkillCard'

/**
 * Agent Skills Settings - shows the global skill library with a per-agent
 * enable/disable toggle, plus local skills from the agent workspace
 * `.claude/skills/` directory.
 *
 * The `isEnabled` field in each skill reflects the state from `agent_skills`
 * for the current agent — toggling only affects this agent's workspace.
 */
export const InstalledSkillsSettings: FC<AgentOrSessionSettingsProps> = ({ agentBase }) => {
  const { t } = useTranslation()
  // Skills are enabled per-agent, not per-session. When the settings popup is
  // opened from a session, `agentBase` is a session object and its parent
  // agent id lives on `agent_id`. When opened from an agent, `agentBase.id`
  // is the agent id.
  const agentId =
    agentBase && 'agent_id' in agentBase && typeof agentBase.agent_id === 'string' ? agentBase.agent_id : agentBase?.id
  const { skills, loading, error, toggle } = useInstalledSkills(agentId)
  const [filter, setFilter] = useState('')
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [localPlugins, setLocalSkills] = useState<LocalSkill[]>([])

  const workdir = agentBase?.accessible_paths?.[0]

  useEffect(() => {
    if (!workdir) return
    void window.api.skill.listLocal(workdir).then((result) => {
      if (result.success) {
        setLocalSkills(result.data)
      }
    })
  }, [workdir])

  const filteredSkills = useMemo(() => {
    if (!filter.trim()) return skills
    const q = filter.toLowerCase()
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.author?.toLowerCase().includes(q)
    )
  }, [skills, filter])

  const filteredLocal = useMemo(() => {
    if (!filter.trim()) return localPlugins
    const q = filter.toLowerCase()
    return localPlugins.filter((p) => p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q))
  }, [localPlugins, filter])

  const handleToggle = useCallback(
    async (skill: InstalledSkill, checked: boolean) => {
      setTogglingId(skill.id)
      try {
        await toggle(skill.id, checked)
      } finally {
        setTogglingId(null)
      }
    },
    [toggle]
  )

  const hasNoResults = filteredSkills.length === 0 && filteredLocal.length === 0

  return (
    <SettingsContainer>
      <SettingsItem divider={false}>
        <SettingsTitle
          contentAfter={
            <>
              <CollapsibleSearchBar
                onSearch={setFilter}
                placeholder={t('agent.settings.skills.searchPlaceholder', 'Search skills...')}
                tooltip={t('agent.settings.skills.searchPlaceholder', 'Search skills...')}
                style={searchBarStyle}
              />
              <Button
                icon={<Plus size={18} />}
                style={{ marginLeft: 'auto' }}
                onClick={() => {
                  TopView.hide('AgentSettingsPopup')
                  window.navigate('/settings/skills')
                }}>
                {t('agent.settings.skills.addMore', 'Add More Skills')}
              </Button>
            </>
          }>
          {t('agent.settings.skills.title', 'Installed Skills')}
        </SettingsTitle>
        <div className="mt-2 flex flex-col gap-3">
          {error ? (
            <div className="rounded-medium border border-default-200 border-dashed px-4 py-10 text-center text-red-500 text-sm">
              {error}
            </div>
          ) : loading ? (
            <div className="flex flex-1 items-center justify-center py-10">
              <Spin />
            </div>
          ) : hasNoResults ? (
            <div className="flex flex-1 items-center justify-center py-10">
              <Empty
                image={<Puzzle size={40} strokeWidth={1} style={emptyIconStyle} />}
                description={
                  filter
                    ? t('agent.settings.skills.noFilterResults', 'No matching skills')
                    : t('agent.settings.skills.noSkills', 'No skills installed. Install skills from Settings > Skills.')
                }
              />
            </div>
          ) : (
            <>
              {filteredSkills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} toggling={togglingId === skill.id} onToggle={handleToggle} />
              ))}
              {filteredLocal.map((plugin) => (
                <LocalSkillCard key={plugin.filename} plugin={plugin} />
              ))}
            </>
          )}
        </div>
      </SettingsItem>
    </SettingsContainer>
  )
}
