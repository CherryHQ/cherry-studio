import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { deleteCustomLanguage } from '@renderer/services/TranslateService'
import { CustomTranslateLanguage } from '@renderer/types'
import { Button, Popconfirm, Table, TableProps } from 'antd'
import { memo, startTransition, use, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingRowTitle } from '..'
import CustomLanguageModal from './CustomLanguageModal'

type Props = {
  dataPromise: Promise<CustomTranslateLanguage[]>
}

const CustomLanguageSettings = ({ dataPromise }: Props) => {
  const { t } = useTranslation()
  const [displayedItems, setDisplayedItems] = useState<CustomTranslateLanguage[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCustomLanguage, setEditingCustomLanguage] = useState<CustomTranslateLanguage>()

  const onDelete = useCallback(
    async (id: string) => {
      try {
        await deleteCustomLanguage(id)
        setDisplayedItems(displayedItems.filter((item) => item.id !== id))
        window.message.success(t('settings.translate.custom.success.delete'))
      } catch (e) {
        window.message.error(t('settings.translate.custom.error.delete'))
      }
    },
    [displayedItems, t]
  )

  const onClickAdd = () => {
    startTransition(async () => {
      setEditingCustomLanguage(undefined)
      setIsModalOpen(true)
    })
  }

  const onClickEdit = (target: CustomTranslateLanguage) => {
    startTransition(async () => {
      setEditingCustomLanguage(target)
      setIsModalOpen(true)
    })
  }

  const onCancel = () => {
    startTransition(async () => {
      setIsModalOpen(false)
    })
  }

  const onItemAdd = (target: CustomTranslateLanguage) => {
    startTransition(async () => {
      setDisplayedItems([...displayedItems, target])
    })
  }

  const onItemEdit = (target: CustomTranslateLanguage) => {
    startTransition(async () => {
      setDisplayedItems(displayedItems.map((item) => (item.id === target.id ? target : item)))
    })
  }

  const columns: TableProps<CustomTranslateLanguage>['columns'] = useMemo(
    () => [
      {
        title: 'Emoji',
        dataIndex: 'emoji'
      },
      {
        title: 'Value',
        dataIndex: 'value'
      },
      {
        title: 'langCode',
        dataIndex: 'langCode'
      },
      {
        title: t('settings.translate.custom.table.action.title'),
        key: 'action',
        render: (_, record) => {
          return (
            <HStack>
              <Button icon={<EditOutlined />} onClick={() => onClickEdit(record)}>
                {t('common.edit')}
              </Button>
              <Popconfirm
                title={t('settings.translate.custom.delete.title')}
                description={t('settings.translate.custom.delete.description')}
                onConfirm={() => onDelete(record.id)}>
                <Button icon={<DeleteOutlined />}>{t('common.delete')}</Button>
              </Popconfirm>
            </HStack>
          )
        }
      }
    ],
    [onDelete, t]
  )

  const data = use(dataPromise)

  useEffect(() => {
    setDisplayedItems(data)
  }, [data])

  return (
    <>
      <CustomLanguageSettingsContainer>
        <HStack justifyContent="space-between" style={{ padding: '4px 0' }}>
          <SettingRowTitle>{t('translate.custom.label')}</SettingRowTitle>
          <Button type="primary" icon={<PlusOutlined size={16} />} onClick={onClickAdd}>
            {t('common.add')}
          </Button>
        </HStack>
        <Table<CustomTranslateLanguage>
          columns={columns}
          pagination={{ position: ['bottomCenter'] }}
          dataSource={displayedItems}
        />
      </CustomLanguageSettingsContainer>
      <CustomLanguageModal
        isOpen={isModalOpen}
        editingCustomLanguage={editingCustomLanguage}
        onAdd={onItemAdd}
        onEdit={onItemEdit}
        onCancel={onCancel}
      />
    </>
  )
}

const CustomLanguageSettingsContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
`

export default memo(CustomLanguageSettings)
