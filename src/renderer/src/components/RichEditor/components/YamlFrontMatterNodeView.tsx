import {
  Checkbox,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { Calendar, Check, FileText, Hash, MoreHorizontal, Plus, Tag as TagIcon, Trash2, Type, X } from 'lucide-react'
import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const getPropertyIcon = (type: ParsedProperty['type'], size = 16) => {
    switch (type) {
      case 'array':
        return <TagIcon size={size} />
      case 'date':
        return <Calendar size={size} />
      case 'number':
        return <Hash size={size} />
      case 'string':
        return <FileText size={size} />
      case 'boolean':
        return <Check size={size} />
      default:
        return <FileText size={size} />
    }
  }

  const typeOptions = useMemo(
    () => [
      {
        type: 'string' as const,
        label: t('richEditor.frontMatter.changeToText'),
        icon: <FileText size={14} />
      },
      {
        type: 'number' as const,
        label: t('richEditor.frontMatter.changeToNumber'),
        icon: <Hash size={14} />
      },
      {
        type: 'boolean' as const,
        label: t('richEditor.frontMatter.changeToBoolean'),
        icon: <Check size={14} />
      },
      {
        type: 'array' as const,
        label: t('richEditor.frontMatter.changeToTags'),
        icon: <TagIcon size={14} />
      },
      {
        type: 'date' as const,
        label: t('richEditor.frontMatter.changeToDate', 'Date'),
        icon: <Calendar size={14} />
      }
    ],
    [t]
  )

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

  const renderContextMenu = (property: ParsedProperty) => (
    <ContextMenuContent className="w-52">
      <ContextMenuItem
        onSelect={() => {
          setEditingProperty(property.key)
        }}>
        <Type size={14} />
        {t('richEditor.frontMatter.editValue')}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>{t('richEditor.frontMatter.changeType')}</ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-44">
          {typeOptions.map((option) => (
            <ContextMenuItem
              key={option.type}
              disabled={property.type === option.type}
              onSelect={() => {
                handleChangePropertyType(property.key, option.type)
              }}>
              {option.icon}
              {option.label}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        onSelect={() => {
          handleDeleteProperty(property.key)
        }}>
        <Trash2 size={14} />
        {t('richEditor.frontMatter.deleteProperty')}
      </ContextMenuItem>
    </ContextMenuContent>
  )

  const renderActionMenu = (property: ParsedProperty) => (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
        onClick={() => {
          setEditingProperty(property.key)
          setOpenDropdown(null)
        }}>
        <Type size={14} />
        {t('richEditor.frontMatter.editValue')}
      </button>
      <div className="-mx-1 my-1 h-px bg-border" />
      <div className="px-2 py-1 text-muted-foreground text-xs">{t('richEditor.frontMatter.changeType')}</div>
      {typeOptions.map((option) => (
        <button
          key={option.type}
          type="button"
          disabled={property.type === option.type}
          className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
          onClick={() => {
            handleChangePropertyType(property.key, option.type)
            setOpenDropdown(null)
          }}>
          {option.icon}
          {option.label}
        </button>
      ))}
      <div className="-mx-1 my-1 h-px bg-border" />
      <button
        type="button"
        className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-destructive text-sm hover:bg-destructive/10"
        onClick={() => {
          handleDeleteProperty(property.key)
          setOpenDropdown(null)
        }}>
        <Trash2 size={14} />
        {t('richEditor.frontMatter.deleteProperty')}
      </button>
    </div>
  )

  // Render property value based on type
  const renderPropertyValue = (property: ParsedProperty) => {
    const isEditing = editingProperty === property.key

    if (property.type === 'array' && Array.isArray(property.value)) {
      const isShowingInput = showArrayInput[property.key]

      return (
        <div className="flex flex-1 flex-wrap items-center gap-1.5">
          {property.value.map((item, index) => (
            <span
              key={index}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-foreground text-xs hover:bg-accent">
              {String(item)}
              <button
                type="button"
                className="flex items-center text-muted-foreground hover:text-destructive"
                onClick={() => handleRemoveArrayItem(property.key, index)}>
                <X size={12} />
              </button>
            </span>
          ))}
          {isShowingInput ? (
            <Input
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
              className="h-6 min-w-20 max-w-30 rounded-full px-2 py-0 text-xs"
            />
          ) : (
            <button
              type="button"
              className="inline-flex size-5 items-center justify-center rounded-full border border-border border-dashed text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
              onClick={() => setShowArrayInput((prev) => ({ ...prev, [property.key]: true }))}>
              <Plus size={12} />
            </button>
          )}
        </div>
      )
    }

    if (property.type === 'boolean') {
      return (
        <Checkbox
          className="ml-2"
          checked={!!property.value}
          onCheckedChange={(checked) => handlePropertyChange(property.key, checked === true)}
        />
      )
    }

    if (isEditing) {
      return (
        <Input
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
          className="h-auto min-h-5 flex-1 border-none bg-transparent px-2 py-1 shadow-none focus-visible:border-transparent focus-visible:ring-0"
        />
      )
    }

    return (
      <button
        type="button"
        className="flex min-h-5 flex-1 items-center rounded px-2 py-1 text-left text-foreground text-sm"
        onClick={() => setEditingProperty(property.key)}>
        {property.value ? (
          String(property.value)
        ) : (
          <span className="text-muted-foreground italic">{t('richEditor.frontMatter.empty')}</span>
        )}
      </button>
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
      <div
        className="group/frontmatter my-4 flex flex-col p-0"
        onClick={(e) => {
          // Prevent node selection when clicking inside properties
          e.stopPropagation()
        }}>
        {parsedProperties.map((property) => (
          <ContextMenu key={property.key}>
            <ContextMenuTrigger asChild>
              <div
                className="group flex min-h-8 items-center rounded-md px-2 py-1.5 hover:bg-accent"
                onContextMenu={(e) => {
                  e.stopPropagation()
                }}>
                <div className="mr-2 flex size-6 shrink-0 items-center justify-center text-muted-foreground">
                  {getPropertyIcon(property.type)}
                </div>
                <div className="mr-3 w-[100px] shrink-0 truncate font-medium text-foreground text-sm capitalize">
                  {property.key}
                </div>
                {renderPropertyValue(property)}
                <div className="mr-1 ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Popover
                    open={openDropdown === `action-${property.key}`}
                    onOpenChange={(open) => {
                      setOpenDropdown(open ? `action-${property.key}` : null)
                    }}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="flex items-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={(e) => e.stopPropagation()}
                        title={t('richEditor.frontMatter.moreActions')}>
                        <MoreHorizontal size={14} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-52 p-1">
                      {renderActionMenu(property)}
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </ContextMenuTrigger>
            {renderContextMenu(property)}
          </ContextMenu>
        ))}

        {showAddProperty ? (
          <div className="flex min-h-8 items-center rounded-md px-2 py-1.5 hover:bg-accent">
            <div className="mr-2 flex size-6 shrink-0 items-center justify-center text-muted-foreground">
              <Plus size={16} />
            </div>
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
          </div>
        ) : (
          <button
            type="button"
            className={cn(
              'flex min-h-8 w-full items-center rounded-md px-2 py-1.5 text-left transition-opacity hover:bg-accent',
              hasContent ? 'opacity-0 group-hover/frontmatter:opacity-100' : 'opacity-100'
            )}
            onClick={() => setShowAddProperty(true)}>
            <div className="mr-2 flex size-6 shrink-0 items-center justify-center text-muted-foreground">
              <Plus size={16} />
            </div>
            <div className="text-muted-foreground text-sm">{t('richEditor.frontMatter.addProperty')}</div>
          </button>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export default YamlFrontMatterNodeView
