import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { HStack } from '@renderer/components/Layout'
import { deleteCustomLanguage, getAllCustomLanguages } from '@renderer/services/TranslateService'
import { CustomTranslateLanguage } from '@renderer/types'
import { Button, Popconfirm, Space, Table, TableProps } from 'antd'
import { memo, startTransition, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingRowTitle } from '..'
import CustomLanguageModal from './CustomLanguageModal'

const logger = loggerService.withContext('CustomLanguageSettings')

const CustomLanguageSettings = () => {
  const { t } = useTranslation()
  const [displayedItems, setDisplayedItems] = useState<CustomTranslateLanguage[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCustomLanguage, setEditingCustomLanguage] = useState<CustomTranslateLanguage>()

  const onDelete = useCallback(
    async (id: string) => {
      try {
        await deleteCustomLanguage(id)
        setDisplayedItems((prev) => prev.filter((item) => item.id !== id))
        window.message.success(t('settings.translate.custom.success.delete'))
      } catch (e) {
        window.message.error(t('settings.translate.custom.error.delete'))
      }
    },
    [t]
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
      setDisplayedItems((prev) => [...prev, target])
    })
  }

  const onItemEdit = (target: CustomTranslateLanguage) => {
    startTransition(async () => {
      setDisplayedItems((prev) => prev.map((item) => (item.id === target.id ? target : item)))
    })
  }

  const columns: TableProps<CustomTranslateLanguage>['columns'] = useMemo(
    () => [
      {
        title: 'Emoji',
        dataIndex: 'emoji'
      },
      {
        title: t('settings.translate.custom.value.label'),
        dataIndex: 'value'
      },
      {
        title: t('settings.translate.custom.langCode.label'),
        dataIndex: 'langCode'
      },
      {
        title: t('settings.translate.custom.table.action.title'),
        key: 'action',
        render: (_, record) => {
          return (
            <Space>
              <Button icon={<EditOutlined />} onClick={() => onClickEdit(record)}>
                {t('common.edit')}
              </Button>
              <Popconfirm
                title={t('settings.translate.custom.delete.title')}
                description={t('settings.translate.custom.delete.description')}
                onConfirm={() => onDelete(record.id)}>
                <Button icon={<DeleteOutlined />} danger>
                  {t('common.delete')}
                </Button>
              </Popconfirm>
            </Space>
          )
        }
      }
    ],
    [onDelete, t]
  )

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await getAllCustomLanguages()
        setDisplayedItems(data)
      } catch (error) {
        logger.error('Failed to load custom languages:', error as Error)
      }
    }
    loadData()
  }, [])

  return (
    <>
      <CustomLanguageSettingsContainer>
        <HStack justifyContent="space-between" style={{ padding: '4px 0' }}>
          <SettingRowTitle>{t('translate.custom.label')}</SettingRowTitle>
          <Button
            type="primary"
            icon={<PlusOutlined size={16} />}
            onClick={onClickAdd}
            style={{ marginBottom: 5, marginTop: -5 }}>
            {t('common.add')}
          </Button>
        </HStack>
        <TableContainer>
          <Table<CustomTranslateLanguage>
            columns={columns}
            pagination={{ position: ['bottomCenter'], defaultPageSize: 10 }}
            dataSource={displayedItems}
          />
        </TableContainer>
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
  justify-content: space-between;
  width: 100%;
  height: 100%;
`

const TableContainer = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
`

export default memo(CustomLanguageSettings)
