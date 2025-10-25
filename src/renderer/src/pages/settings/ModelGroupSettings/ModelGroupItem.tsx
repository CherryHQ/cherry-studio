import { useProviders } from '@renderer/hooks/useProvider'
import { ModelGroup } from '@renderer/types'
import { modalConfirm } from '@renderer/utils'
import { Button, Tag } from 'antd'
import { Edit, Folder, Trash2 } from 'lucide-react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  group: ModelGroup
  onEdit: (group: ModelGroup) => void
  onDelete: (groupId: string) => void
}

const ModelGroupItem: FC<Props> = ({ group, onEdit, onDelete }) => {
  const { t } = useTranslation()
  const { providers } = useProviders()

  const getModelName = (modelId: string, providerId: string) => {
    const provider = providers.find((p) => p.id === providerId)
    const model = provider?.models.find((m) => m.id === modelId)
    return model ? `${model.name} (${provider?.name})` : `${modelId} (${providerId})`
  }

  const handleDelete = async () => {
    const confirmed = await modalConfirm({
      title: t('settings.modelGroup.delete'),
      content: t('settings.modelGroup.confirmDelete'),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true }
    })

    if (confirmed) {
      onDelete(group.id)
    }
  }

  return (
    <Container>
      <Header>
        <TitleSection>
          <Folder size={18} style={{ flexShrink: 0 }} />
          <div>
            <GroupName>{group.name}</GroupName>
            {group.description && <GroupDescription>{group.description}</GroupDescription>}
          </div>
        </TitleSection>
        <Actions>
          <Button size="small" icon={<Edit size={14} />} onClick={() => onEdit(group)}>
            {t('common.edit')}
          </Button>
          <Button size="small" danger icon={<Trash2 size={14} />} onClick={handleDelete}>
            {t('common.delete')}
          </Button>
        </Actions>
      </Header>
      <ModelsSection>
        {group.models.length === 0 ? (
          <EmptyText>{t('settings.modelGroup.selectModels')}</EmptyText>
        ) : (
          <ModelTags>
            {group.models.map((ref, index) => (
              <Tag key={index} color="blue">
                {getModelName(ref.modelId, ref.providerId)}
              </Tag>
            ))}
          </ModelTags>
        )}
      </ModelsSection>
    </Container>
  )
}

const Container = styled.div`
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  padding: 16px;
  background: var(--color-background);
  transition: all 0.2s;

  &:hover {
    border-color: var(--color-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  }
`

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
`

const TitleSection = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex: 1;
  min-width: 0;
`

const GroupName = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
  word-break: break-word;
`

const GroupDescription = styled.div`
  font-size: 13px;
  color: var(--color-text-2);
  margin-top: 4px;
  word-break: break-word;
`

const Actions = styled.div`
  display: flex;
  gap: 8px;
  flex-shrink: 0;
`

const ModelsSection = styled.div`
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
`

const ModelTags = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const EmptyText = styled.div`
  color: var(--color-text-3);
  font-size: 13px;
  font-style: italic;
`

export default ModelGroupItem
