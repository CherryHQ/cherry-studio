import { DownOutlined, RightOutlined } from '@ant-design/icons'
import type { AgentEntity } from '@renderer/types'
import { cn } from '@renderer/utils'
import { Button, Tooltip } from 'antd'
import { Eye } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface BuiltinAgentsSectionProps {
  hiddenAgents: AgentEntity[]
  orphanedCount: number
  onShow: (agent: AgentEntity) => void
  onRestoreOrphaned?: () => void
  isCollapsedDefault?: boolean
}

export const BuiltinAgentsSection: FC<BuiltinAgentsSectionProps> = ({
  hiddenAgents,
  orphanedCount,
  onShow,
  onRestoreOrphaned,
  isCollapsedDefault = false
}) => {
  const { t } = useTranslation()
  const [isCollapsed, setIsCollapsed] = useState(isCollapsedDefault)

  if (hiddenAgents.length === 0 && orphanedCount === 0) return null

  return (
    <div className="px-2.5 pb-2">
      <SectionHeader onClick={() => setIsCollapsed(!isCollapsed)}>
        {isCollapsed ? (
          <RightOutlined style={{ fontSize: '10px', marginRight: '5px' }} />
        ) : (
          <DownOutlined style={{ fontSize: '10px', marginRight: '5px' }} />
        )}
        <SectionTitle>{t('agent.default_section.title')}</SectionTitle>
        <SectionDivider />
      </SectionHeader>
      {!isCollapsed && (
        <div className="mt-1 flex flex-col gap-1">
          {hiddenAgents.map((agent) => (
            <HiddenAgentItem
              key={agent.id}
              agent={agent}
              onShow={() => onShow(agent)}
            />
          ))}
          {orphanedCount > 0 && (
            <div
              className={cn(
                'flex h-8 items-center justify-between rounded-lg px-2',
                'text-(--color-text-secondary) text-[13px]'
              )}
            >
              <span>{t('agent.default_section.orphaned', { count: orphanedCount })}</span>
              <Tooltip title={t('agent.restore.button')}>
                <Button type="text" size="small" onClick={onRestoreOrphaned}>
                  <span className="text-[13px]">{t('agent.restore.button')}</span>
                </Button>
              </Tooltip>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface HiddenAgentItemProps {
  agent: AgentEntity
  onShow: () => void
}

const HiddenAgentItem: FC<HiddenAgentItemProps> = ({ agent, onShow }) => {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        'flex h-8 items-center justify-between rounded-lg px-2',
        'text-(--color-text-secondary) text-[13px]',
        'hover:bg-(--color-list-item-hover)'
      )}
    >
      <span className="truncate">{agent.name ?? agent.id}</span>
      <Tooltip title={t('agent.show.button')}>
        <Button
          type="text"
          size="small"
          icon={<Eye size={14} className="text-(--color-text-secondary)" />}
          onClick={onShow}
        />
      </Tooltip>
    </div>
  )
}

const SectionHeader: FC<{ onClick: () => void } & React.HTMLAttributes<HTMLDivElement>> = ({
  onClick,
  children,
  ...props
}) => (
  <div
    className={cn(
      'flex h-6 cursor-pointer items-center justify-between',
      'font-medium text-(--color-text-2) text-xs'
    )}
    onClick={onClick}
    {...props}
  >
    {children}
  </div>
)

const SectionTitle: FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, ...props }) => (
  <div
    className={cn('mr-1 box-border flex max-w-[50%] truncate px-1 text-[13px] text-(--color-text) leading-6')}
    {...props}
  >
    {children}
  </div>
)

const SectionDivider: FC<React.HTMLAttributes<HTMLDivElement>> = (props) => (
  <div className={cn('flex-1 border-(--color-border) border-t')} {...props} />
)

export default BuiltinAgentsSection
