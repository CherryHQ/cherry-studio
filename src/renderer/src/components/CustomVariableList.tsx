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

const CustomVariableList: React.FC<VariableListProps> = ({ variables, setVariables, onUpdate, onInsertVariable }) => {
  const { t } = useTranslation()

  // 使用过滤而不是findIndex + splice组合，性能更好
  const deleteVariable = (id: string) => {
    const updatedVariables = variables.filter((v) => v.id !== id)
    setVariables(updatedVariables)

    // 只有在需要时才触发父组件更新
    onUpdate?.(updatedVariables)
  }

  // 局部状态更新，减少不必要的渲染
  const updateVariable = (id: string, field: 'name' | 'value', value: string) => {
    setVariables(variables.map((v) => (v.id === id ? { ...v, [field]: value } : v)))
    // 不调用onUpdate，避免频繁触发
  }

  // 失焦时才同步到父组件，优化性能
  const handleInputBlur = () => {
    onUpdate?.(variables)
  }

  if (variables.length === 0) {
    return (
      <VariablesContainer>
        <EmptyText>{t('variable.no_variables_added')}</EmptyText>
      </VariablesContainer>
    )
  }

  return (
    <VariablesContainer>
      <VStack gap={8} width="100%">
        {variables.map((variable) => (
          <VariableItem key={variable.id}>
            <NameInput
              placeholder={t('variable.variable_name')}
              value={variable.name}
              onChange={(e) => updateVariable(variable.id, 'name', e.target.value)}
              onBlur={handleInputBlur}
            />
            <ValueInput
              placeholder={t('variable.value')}
              value={variable.value}
              onChange={(e) => updateVariable(variable.id, 'value', e.target.value)}
              onBlur={handleInputBlur}
            />
            {onInsertVariable && (
              <InsertButton
                title={t('variable.insert_variable_into_prompt')}
                onClick={() => onInsertVariable(`custom.${variable.name}`)}
              />
            )}
            <DeleteButton onClick={() => deleteVariable(variable.id)} />
          </VariableItem>
        ))}
      </VStack>
    </VariablesContainer>
  )
}

// 提取各个组件，使代码更模块化
const NameInput = styled(Input)`
  width: 30%;
`

const ValueInput = styled(Input)`
  flex: 1;
`

const InsertButton = ({ title, onClick }) => (
  <Tooltip title={title}>
    <Button type="text" onClick={onClick}>
      <ImportOutlined />
    </Button>
  </Tooltip>
)

const DeleteButton = ({ onClick }) => <Button type="text" danger icon={<DeleteOutlined />} onClick={onClick} />

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

export default CustomVariableList
