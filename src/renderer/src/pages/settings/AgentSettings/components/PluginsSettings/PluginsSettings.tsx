import Scrollbar from '@renderer/components/Scrollbar'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import type { GetAgentResponse, GetAgentSessionResponse, UpdateAgentFunctionUnion } from '@renderer/types/agent'
import type { InstalledSkill } from '@types'
import { Empty, Input, Spin, Switch, Tag } from 'antd'
import { Puzzle, Search } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingsContainer } from '../../shared'

interface PluginSettingsProps {
  agentBase: GetAgentResponse | GetAgentSessionResponse
  update: UpdateAgentFunctionUnion
}

/**
 * Agent Skills Settings - shows globally installed skills with enable/disable toggle.
 * Skills are installed globally via Settings > Skills page.
 * Enabling a skill makes it available to this agent via symlink.
 */
export const InstalledPluginsSettings: FC<PluginSettingsProps> = () => {
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
      <SearchContainer>
        <Input
          placeholder={t('agent.settings.skills.searchPlaceholder', 'Search skills...')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          prefix={<Search size={14} style={{ opacity: 0.4 }} />}
          allowClear
        />
      </SearchContainer>

      {error ? (
        <ErrorText>{error}</ErrorText>
      ) : loading ? (
        <CenterContainer>
          <Spin />
        </CenterContainer>
      ) : filteredSkills.length === 0 ? (
        <CenterContainer>
          <Empty
            image={<Puzzle size={40} strokeWidth={1} style={{ opacity: 0.3 }} />}
            description={
              filter
                ? t('agent.settings.skills.noFilterResults', 'No matching skills')
                : t('agent.settings.skills.noSkills', 'No skills installed. Install skills from Settings > Skills.')
            }
          />
        </CenterContainer>
      ) : (
        <Scrollbar className="min-h-0 flex-1">
          <SkillList>
            {filteredSkills.map((skill) => (
              <SkillItem key={skill.id}>
                <SkillIcon>
                  <Puzzle size={16} />
                </SkillIcon>
                <SkillInfo>
                  <SkillName>{skill.name}</SkillName>
                  {skill.description && <SkillDesc>{skill.description}</SkillDesc>}
                  <SkillMeta>
                    {skill.author && <Tag style={{ fontSize: 11 }}>{skill.author}</Tag>}
                    <Tag color={skill.source === 'builtin' ? 'green' : 'blue'} style={{ fontSize: 11 }}>
                      {skill.source === 'builtin' ? t('agent.settings.skills.builtin', 'Built-in') : skill.source}
                    </Tag>
                  </SkillMeta>
                </SkillInfo>
                {skill.source !== 'builtin' && (
                  <Switch
                    checked={skill.isEnabled}
                    loading={togglingId === skill.id}
                    onChange={(checked) => handleToggle(skill, checked)}
                    size="small"
                  />
                )}
              </SkillItem>
            ))}
          </SkillList>
        </Scrollbar>
      )}
    </SettingsContainer>
  )
}

const SearchContainer = styled.div`
  padding: 0 16px 12px;
`

const CenterContainer = styled.div`
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
`

const ErrorText = styled.div`
  padding: 16px;
  color: var(--color-error);
`

const SkillList = styled.div`
  display: flex;
  flex-direction: column;
  padding: 0 16px;
  gap: 2px;
`

const SkillItem = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  transition: background 0.15s;

  &:hover {
    background: var(--color-background-soft);
  }
`

const SkillIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-text-2);
  flex-shrink: 0;
`

const SkillInfo = styled.div`
  flex: 1;
  min-width: 0;
`

const SkillName = styled.div`
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const SkillDesc = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
`

const SkillMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
`
