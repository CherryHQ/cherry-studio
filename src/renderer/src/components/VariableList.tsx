import { DeleteOutlined, ImportOutlined } from '@ant-design/icons'
import { VStack } from '@renderer/components/Layout'
import { Variable } from '@renderer/types'
import { Button, Input, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface VariableListProps {
  variables: Variable[]
  setVariables: (variables: Variable[]) => void
  onUpdate?: (variables: Variable[]) => void
  onInsertVariable?: (name: string) => void
}

const VariableList: React.FC<VariableListProps> = ({ variables, setVariables, onUpdate, onInsertVariable }) => {
  const { t } = useTranslation()

  const deleteVariable = (id: string) => {
    const updatedVariables = variables.filter((v) => v.id !== id)
    setVariables(updatedVariables)

    if (onUpdate) {
      onUpdate(updatedVariables)
    }
  }

  const updateVariable = (id: string, field: 'name' | 'value', value: string) => {
    // Only update the local state when typing, don't call the parent's onUpdate
    const updatedVariables = variables.map((v) => (v.id === id ? { ...v, [field]: value } : v))
    setVariables(updatedVariables)
  }

  // This function will be called when input loses focus
  const handleInputBlur = () => {
    if (onUpdate) {
      onUpdate(variables)
    }
  }

  return (
    <VariablesContainer>
      {variables.length === 0 ? (
        <EmptyText>{t('common.no_variables_added')}</EmptyText>
      ) : (
        <VStack gap={8} width="100%">
          {variables.map((variable) => (
            <VariableItem key={variable.id}>
              <Input
                placeholder={t('common.variable_name')}
                value={variable.name}
                onChange={(e) => updateVariable(variable.id, 'name', e.target.value)}
                onBlur={handleInputBlur}
                style={{ width: '30%' }}
              />
              <Input
                placeholder={t('common.value')}
                value={variable.value}
                onChange={(e) => updateVariable(variable.id, 'value', e.target.value)}
                onBlur={handleInputBlur}
                style={{ flex: 1 }}
              />
              {onInsertVariable && (
                <Tooltip title={t('common.insert_variable_into_prompt')}>
                  <Button type="text" onClick={() => onInsertVariable(variable.name)}>
                    <ImportOutlined />
                  </Button>
                </Tooltip>
              )}
              <Button type="text" danger icon={<DeleteOutlined />} onClick={() => deleteVariable(variable.id)} />
            </VariableItem>
          ))}
        </VStack>
      )}
    </VariablesContainer>
  )
}

const VariablesContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  overflow-y: auto;
  max-height: 200px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 12px;
`

const VariableItem = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
`

const EmptyText = styled.div`
  color: var(--color-text-2);
  opacity: 0.6;
  font-style: italic;
`

export default VariableList
