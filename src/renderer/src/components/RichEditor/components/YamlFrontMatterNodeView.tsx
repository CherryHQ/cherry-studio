import { loggerService } from '@logger'
import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { Checkbox, Dropdown, Input, type MenuProps } from 'antd'
import { Calendar, Check, FileText, Hash, MoreHorizontal, Plus, Tag as TagIcon, Trash2, Type, X } from 'lucide-react'
import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { parse, stringify } from 'yaml'

const logger = loggerService.withContext('YamlFrontMatterNodeView')

interface ParsedProperty {
  key: string
  value: any
  type: 'string' | 'array' | 'date' | 'number' | 'boolean'
}

const YamlFrontMatterNodeView: React.FC<NodeViewProps> = ({ node, updateAttributes, editor }) => {
  const { t } = useTranslation()
  const [editingProperty, setEditingProperty] = useState<string | null>(null)
  const [newPropertyName, setNewPropertyName] = useState('')
  const [showAddProperty, setShowAddProperty] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [arrayInputValues, setArrayInputValues] = useState<Record<string, string>>({})
  const [showArrayInput, setShowArrayInput] = useState<Record<string, boolean>>({})

  // Parse YAML content into structured properties
  const parsedProperties = useMemo((): ParsedProperty[] => {
    try {
      const content = node.attrs.content || ''
      const yamlContent = content.replace(/\n---\s*$/, '') // Remove closing fence

      if (!yamlContent.trim()) return []

      const parsed = parse(yamlContent)
      if (!parsed || typeof parsed !== 'object') return []

      return Object.entries(parsed).map(([key, value]): ParsedProperty => {
        let type: ParsedProperty['type'] = 'string'

        if (Array.isArray(value)) {
          type = 'array'
        } else if (typeof value === 'number') {
          type = 'number'
        } else if (typeof value === 'boolean') {
          type = 'boolean'
        } else if (value instanceof Date || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))) {
          type = 'date'
        }

        return { key, value, type }
      })
    } catch (error) {
      logger.warn('Failed to parse YAML front matter:', error as Error)
      return []
    }
  }, [node.attrs.content])

  // Get icon for property type
  const getPropertyIcon = (type: ParsedProperty['type']) => {
    switch (type) {
      case 'array':
        return <TagIcon size={16} />
      case 'date':
        return <Calendar size={16} />
      case 'number':
        return <Hash size={16} />
      case 'string':
        return <FileText size={16} />
      case 'boolean':
        return <Check size={16} />
      default:
        return <FileText size={16} />
    }
  }

  // Update YAML content from properties
  const updateYamlFromProperties = useCallback(
    (properties: ParsedProperty[]) => {
      try {
        const yamlObject = properties.reduce(
          (acc, prop) => {
            acc[prop.key] = prop.value
            return acc
          },
          {} as Record<string, any>
        )

        const yamlContent = stringify(yamlObject).trim()
        const contentWithFence = yamlContent + '\n---'
        updateAttributes({ content: contentWithFence })
      } catch (error) {
        logger.error('Failed to update YAML:', error as Error)
      }
    },
    [updateAttributes]
  )

  // Handle property value change
  const handlePropertyChange = useCallback(
    (key: string, newValue: any) => {
      const updatedProperties = parsedProperties.map((prop) => (prop.key === key ? { ...prop, value: newValue } : prop))
      updateYamlFromProperties(updatedProperties)
      setEditingProperty(null)
    },
    [parsedProperties, updateYamlFromProperties]
  )

  // Handle array item removal
  const handleRemoveArrayItem = useCallback(
    (key: string, index: number) => {
      const property = parsedProperties.find((p) => p.key === key)
      if (property && Array.isArray(property.value)) {
        const newArray = property.value.filter((_, i) => i !== index)
        handlePropertyChange(key, newArray)
      }
    },
    [parsedProperties, handlePropertyChange]
  )

  // Handle array item addition
  const handleAddArrayItem = useCallback(
    (key: string, value: string) => {
      if (!value.trim()) return

      const property = parsedProperties.find((p) => p.key === key)
      if (property && Array.isArray(property.value)) {
        const newArray = [...property.value, value.trim()]
        handlePropertyChange(key, newArray)
        setArrayInputValues((prev) => ({ ...prev, [key]: '' }))
        setShowArrayInput((prev) => ({ ...prev, [key]: false }))
      }
    },
    [parsedProperties, handlePropertyChange]
  )

  // Add new property
  const handleAddProperty = useCallback(() => {
    if (newPropertyName.trim()) {
      const updatedProperties = [
        ...parsedProperties,
        {
          key: newPropertyName.trim(),
          value: '',
          type: 'string' as const
        }
      ]
      updateYamlFromProperties(updatedProperties)
      setNewPropertyName('')
      setShowAddProperty(false)
    }
  }, [newPropertyName, parsedProperties, updateYamlFromProperties])

  // Delete property
  const handleDeleteProperty = useCallback(
    (propertyKey: string) => {
      const updatedProperties = parsedProperties.filter((prop) => prop.key !== propertyKey)
      updateYamlFromProperties(updatedProperties)
    },
    [parsedProperties, updateYamlFromProperties]
  )

  // Change property type
  const handleChangePropertyType = useCallback(
    (propertyKey: string, newType: ParsedProperty['type']) => {
      const updatedProperties = parsedProperties.map((prop) => {
        if (prop.key === propertyKey) {
          let newValue = prop.value
          // Convert value based on new type
          switch (newType) {
            case 'array':
              newValue = Array.isArray(prop.value) ? prop.value : [String(prop.value)]
              break
            case 'number':
              newValue = typeof prop.value === 'number' ? prop.value : Number(String(prop.value)) || 0
              break
            case 'boolean':
              newValue = typeof prop.value === 'boolean' ? prop.value : String(prop.value).toLowerCase() === 'true'
              break
            case 'string':
              newValue = String(prop.value)
              break
            case 'date':
              newValue = prop.value instanceof Date ? prop.value.toISOString().split('T')[0] : String(prop.value)
              break
          }
          return { ...prop, type: newType, value: newValue }
        }
        return prop
      })
      updateYamlFromProperties(updatedProperties)
    },
    [parsedProperties, updateYamlFromProperties]
  )

  // Create context menu for property
  const getPropertyMenu = useCallback(
    (property: ParsedProperty): MenuProps => {
      return {
        items: [
          {
            key: 'edit',
            label: (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Type size={14} />
                {t('richEditor.frontMatter.editValue')}
              </span>
            ),
            onClick: () => {
              setEditingProperty(property.key)
              setOpenDropdown(null)
            }
          },
          {
            type: 'divider'
          },
          {
            key: 'type',
            label: t('richEditor.frontMatter.changeType'),
            children: [
              {
                key: 'string',
                label: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileText size={14} />
                    {t('richEditor.frontMatter.changeToText')}
                  </span>
                ),
                disabled: property.type === 'string',
                onClick: () => {
                  handleChangePropertyType(property.key, 'string')
                  setOpenDropdown(null)
                }
              },
              {
                key: 'number',
                label: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Hash size={14} />
                    {t('richEditor.frontMatter.changeToNumber')}
                  </span>
                ),
                disabled: property.type === 'number',
                onClick: () => {
                  handleChangePropertyType(property.key, 'number')
                  setOpenDropdown(null)
                }
              },
              {
                key: 'boolean',
                label: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Check size={14} />
                    {t('richEditor.frontMatter.changeToBoolean')}
                  </span>
                ),
                disabled: property.type === 'boolean',
                onClick: () => {
                  handleChangePropertyType(property.key, 'boolean')
                  setOpenDropdown(null)
                }
              },
              {
                key: 'array',
                label: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TagIcon size={14} />
                    {t('richEditor.frontMatter.changeToTags')}
                  </span>
                ),
                disabled: property.type === 'array',
                onClick: () => {
                  handleChangePropertyType(property.key, 'array')
                  setOpenDropdown(null)
                }
              },
              {
                key: 'date',
                label: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Calendar size={14} />
                    {t('richEditor.frontMatter.changeToDate', 'Date')}
                  </span>
                ),
                disabled: property.type === 'date',
                onClick: () => {
                  handleChangePropertyType(property.key, 'date')
                  setOpenDropdown(null)
                }
              }
            ]
          },
          {
            type: 'divider'
          },
          {
            key: 'delete',
            label: (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ef4444' }}>
                <Trash2 size={14} />
                {t('richEditor.frontMatter.deleteProperty')}
              </span>
            ),
            onClick: () => {
              handleDeleteProperty(property.key)
              setOpenDropdown(null)
            }
          }
        ]
      }
    },
    [t, handleChangePropertyType, handleDeleteProperty]
  )

  // Render property value based on type
  const renderPropertyValue = (property: ParsedProperty) => {
    const isEditing = editingProperty === property.key

    if (property.type === 'array' && Array.isArray(property.value)) {
      const isShowingInput = showArrayInput[property.key]

      return (
        <TagContainer>
          {property.value.map((item, index) => (
            <Tag key={index}>
              {String(item)}
              <TagRemove onClick={() => handleRemoveArrayItem(property.key, index)}>
                <X size={12} />
              </TagRemove>
            </Tag>
          ))}
          {isShowingInput ? (
            <ArrayInput
              placeholder={t('richEditor.frontMatter.addTag')}
              value={arrayInputValues[property.key] || ''}
              onChange={(e) => setArrayInputValues((prev) => ({ ...prev, [property.key]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddArrayItem(property.key, arrayInputValues[property.key] || '')
                } else if (e.key === 'Escape') {
                  setShowArrayInput((prev) => ({ ...prev, [property.key]: false }))
                  setArrayInputValues((prev) => ({ ...prev, [property.key]: '' }))
                }
              }}
              onBlur={() => {
                const value = arrayInputValues[property.key] || ''
                if (value.trim()) {
                  handleAddArrayItem(property.key, value)
                } else {
                  setShowArrayInput((prev) => ({ ...prev, [property.key]: false }))
                }
              }}
              autoFocus
            />
          ) : (
            <AddTagButton onClick={() => setShowArrayInput((prev) => ({ ...prev, [property.key]: true }))}>
              <Plus size={12} />
            </AddTagButton>
          )}
        </TagContainer>
      )
    }

    if (property.type === 'boolean') {
      return (
        <Checkbox
          style={{ paddingLeft: 8 }}
          checked={property.value}
          onChange={(e) => handlePropertyChange(property.key, e.target.checked)}
        />
      )
    }

    if (isEditing) {
      return (
        <StyledInput
          defaultValue={String(property.value)}
          onBlur={(e) => {
            let newValue: any = e.target.value
            if (property.type === 'number') {
              newValue = Number(newValue) || 0
            } else if (property.type === 'boolean') {
              newValue = newValue.toLowerCase() === 'true'
            }
            handlePropertyChange(property.key, newValue)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              setEditingProperty(null)
            }
          }}
          autoFocus
        />
      )
    }

    return (
      <PropertyValue onClick={() => setEditingProperty(property.key)}>
        {property.value ? (
          String(property.value)
        ) : (
          <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>{t('richEditor.frontMatter.empty')}</span>
        )}
      </PropertyValue>
    )
  }

  // Check if there's content in the entire editor (excluding YAML front matter)
  const hasContent = useMemo(() => {
    return editor.getText().trim().length > 0
  }, [editor])

  return (
    <NodeViewWrapper
      className="yaml-front-matter-wrapper"
      onContextMenu={(e) => {
        // Only prevent if the context menu is triggered on the wrapper itself
        if (e.target === e.currentTarget) {
          e.preventDefault()
        }
      }}>
      <PropertiesContainer
        hasContent={hasContent}
        onClick={(e) => {
          // Prevent node selection when clicking inside properties
          e.stopPropagation()
        }}>
        {parsedProperties.map((property) => (
          <Dropdown
            key={property.key}
            menu={getPropertyMenu(property)}
            trigger={['contextMenu']}
            placement="bottomRight"
            open={openDropdown === `context-${property.key}`}
            onOpenChange={(open) => {
              setOpenDropdown(open ? `context-${property.key}` : null)
            }}>
            <PropertyRow
              onContextMenu={(e) => {
                e.stopPropagation()
              }}>
              <PropertyIcon>{getPropertyIcon(property.type)}</PropertyIcon>
              <PropertyName>{property.key}</PropertyName>
              {renderPropertyValue(property)}
              <PropertyActions>
                <Dropdown
                  menu={getPropertyMenu(property)}
                  trigger={['click']}
                  placement="bottomRight"
                  open={openDropdown === `action-${property.key}`}
                  onOpenChange={(open) => {
                    setOpenDropdown(open ? `action-${property.key}` : null)
                  }}>
                  <ActionButton onClick={(e) => e.stopPropagation()} title={t('richEditor.frontMatter.moreActions')}>
                    <MoreHorizontal size={14} />
                  </ActionButton>
                </Dropdown>
              </PropertyActions>
            </PropertyRow>
          </Dropdown>
        ))}

        {showAddProperty ? (
          <PropertyRow>
            <PropertyIcon>
              <Plus size={16} />
            </PropertyIcon>
            <Input
              placeholder={t('richEditor.frontMatter.propertyName')}
              value={newPropertyName}
              onChange={(e) => setNewPropertyName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleAddProperty()
                } else if (e.key === 'Escape') {
                  setShowAddProperty(false)
                  setNewPropertyName('')
                }
              }}
              onBlur={() => {
                if (newPropertyName.trim()) {
                  handleAddProperty()
                } else {
                  setShowAddProperty(false)
                }
              }}
              autoFocus
            />
          </PropertyRow>
        ) : (
          <AddPropertyRow hasContent={hasContent} onClick={() => setShowAddProperty(true)}>
            <PropertyIcon>
              <Plus size={16} />
            </PropertyIcon>
            <AddPropertyText>{t('richEditor.frontMatter.addProperty')}</AddPropertyText>
          </AddPropertyRow>
        )}
      </PropertiesContainer>
    </NodeViewWrapper>
  )
}

const PropertiesContainer = styled.div<{ hasContent?: boolean }>`
  margin: 16px 0;
  padding: 0;
  display: flex;
  flex-direction: column;
`

const PropertyRow = styled.div`
  display: flex;
  align-items: center;
  padding: 6px 8px;
  margin: 0 -8px;
  min-height: 32px;
  border-radius: 6px;

  &:hover {
    background-color: var(--color-hover);
  }
`

const PropertyIcon = styled.div`
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
  color: var(--color-icon);
`

const PropertyName = styled.div`
  min-width: 100px;
  max-width: 100px;
  font-size: 14px;
  font-family: var(--font-family);
  font-weight: 500;
  color: var(--color-text);
  margin-right: 12px;
  text-transform: capitalize;
`

const PropertyValue = styled.div`
  flex: 1;
  font-size: 14px;
  font-family: var(--font-family);
  color: var(--color-text);
  cursor: pointer;
  padding: 6px 8px;
  margin: -2px 0;
  border-radius: 4px;
  min-height: 20px;
  display: flex;
  align-items: center;
`

const TagContainer = styled.div`
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
`

const Tag = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  background-color: var(--color-background-mute);
  border-radius: 12px;
  font-size: 12px;
  font-family: var(--font-family);
  color: var(--color-text);
  gap: 4px;

  &:hover {
    background-color: var(--color-background-soft);
  }
`

const TagRemove = styled.button`
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--color-icon);
  display: flex;
  align-items: center;

  &:hover {
    color: var(--color-error);
  }
`

const StyledInput = styled(Input)`
  border: none !important;
  outline: none !important;
  background: transparent !important;
  font-size: 14px;
  font-family: var(--font-family);
  color: var(--color-text);
  width: 100%;
  padding: 6px 8px;
  margin: -2px 0;
  border-radius: 4px;
  min-height: 20px;
  cursor: text;
  box-shadow: none !important;

  &::placeholder {
    color: #9ca3af;
  }

  &:hover {
    background-color: var(--color-hover) !important;
    border: none !important;
    box-shadow: none !important;
  }

  &:focus {
    border: none !important;
    box-shadow: none !important;
  }

  &.ant-input {
    border: none !important;
    box-shadow: none !important;
  }

  &.ant-input:hover {
    border: none !important;
    box-shadow: none !important;
  }

  &.ant-input:focus {
    border: none !important;
    box-shadow: none !important;
  }
`

const AddTagButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  background: none;
  border: 1px dashed #d1d5db;
  border-radius: 10px;
  color: #9ca3af;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: var(--color-primary);
    color: #3b82f6;
    background-color: rgba(59, 130, 246, 0.05);
  }
`

const ArrayInput = styled(Input)`
  display: inline-flex;
  border: 1px solid #e5e7eb !important;
  outline: none !important;
  background: transparent !important;
  font-size: 12px;
  font-family: var(--font-family);
  padding: 2px 8px !important;
  border-radius: 12px;
  min-width: 80px;
  max-width: 120px;
  height: 24px;
  cursor: text;
  box-shadow: none !important;
  vertical-align: top;

  &::placeholder {
    color: #9ca3af;
    font-size: 12px;
  }

  &:hover {
    border-color: var(--color-border) !important;
    box-shadow: none !important;
  }

  &:focus {
    border-color: var(--color-primary) !important;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1) !important;
  }

  &.ant-input {
    font-size: 12px;
    height: 24px;
    display: inline-flex;
    vertical-align: top;
  }

  &.ant-input:hover {
    border-color: var(--color-border) !important;
    box-shadow: none !important;
  }

  &.ant-input:focus {
    border-color: var(--color-primary) !important;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1) !important;
  }
`

const AddPropertyRow = styled.button<{ hasContent?: boolean }>`
  display: flex;
  align-items: center;
  padding: 6px 8px;
  margin: 0 -8px;
  min-height: 32px;
  background: none;
  border: none;
  cursor: pointer;
  border-radius: 6px;
  width: 100%;
  opacity: ${({ hasContent }) => (hasContent ? 0 : 1)};
  transition: opacity 0.2s;

  &:hover {
    background-color: var(--color-hover);
  }

  ${PropertiesContainer}:hover & {
    opacity: 1;
  }
`

const AddPropertyText = styled.div`
  font-size: 14px;
  font-family: var(--font-family);
  color: var(--color-text-secondary);
`

const PropertyActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
  margin-left: auto;
  margin-right: 4px;

  ${PropertyRow}:hover & {
    opacity: 1;
  }
`

const ActionButton = styled.button`
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: #6b7280;
  border-radius: 4px;
  display: flex;
  align-items: center;

  &:hover {
    background-color: var(--color-hover);
    color: #374151;
  }
`

export default YamlFrontMatterNodeView
