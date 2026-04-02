import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import type { InstalledSkill } from '@types'
import type { CardProps } from 'antd'
import { Card, Empty, Spin, Switch, Tag } from 'antd'
import { Puzzle } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
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

/**
 * Agent Skills Settings - shows globally installed skills with enable/disable toggle.
 * Skills are installed globally via Settings > Skills page.
 * Enabling a skill makes it available to this agent via symlink.
 */
export const InstalledSkillsSettings: FC<AgentOrSessionSettingsProps> = () => {
  const { t } = useTranslation()
  const { skills, loading, error, toggle } = useInstalledSkills()
  const [filter, setFilter] = useState('')
  const [togglingId, setTogglingId] = useState<string | null>(null)

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

  return (
    <SettingsContainer>
      <SettingsItem divider={false}>
        <SettingsTitle
          contentAfter={
            <CollapsibleSearchBar
              onSearch={setFilter}
              placeholder={t('agent.settings.skills.searchPlaceholder', 'Search skills...')}
              tooltip={t('agent.settings.skills.searchPlaceholder', 'Search skills...')}
              style={{ borderRadius: 20 }}
            />
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
          ) : filteredSkills.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-10">
              <Empty
                image={<Puzzle size={40} strokeWidth={1} style={{ opacity: 0.3 }} />}
                description={
                  filter
                    ? t('agent.settings.skills.noFilterResults', 'No matching skills')
                    : t('agent.settings.skills.noSkills', 'No skills installed. Install skills from Settings > Skills.')
                }
              />
            </div>
          ) : (
            filteredSkills.map((skill) => (
              <Card
                key={skill.id}
                className="border border-default-200"
                title={
                  <div className="flex items-start justify-between gap-3 py-2">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="truncate font-medium text-sm">{skill.name}</span>
                      {skill.description ? (
                        <span className="line-clamp-2 whitespace-normal text-foreground-500 text-xs">
                          {skill.description}
                        </span>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2">
                        {skill.author && <Tag>{skill.author}</Tag>}
                        <Tag color={skill.source === 'builtin' ? 'green' : 'blue'}>
                          {skill.source === 'builtin' ? t('agent.settings.skills.builtin', 'Built-in') : skill.source}
                        </Tag>
                      </div>
                    </div>
                    {skill.source !== 'builtin' && (
                      <Switch
                        checked={skill.isEnabled}
                        loading={togglingId === skill.id}
                        onChange={(checked) => handleToggle(skill, checked)}
                        size="small"
                      />
                    )}
                  </div>
                }
                styles={cardStyles}
              />
            ))
          )}
        </div>
      </SettingsItem>
    </SettingsContainer>
  )
}
