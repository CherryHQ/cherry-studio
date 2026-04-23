import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { RowFlex } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { useDeleteLanguage, useLanguages } from '@renderer/hooks/translate'
import type { TranslateLanguageVo } from '@renderer/types'
import type { TableProps } from 'antd'
import { Popconfirm, Space, Table } from 'antd'
import { memo, startTransition, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingRowTitle } from '..'
import TranslateLanguagesModal from './TranslateLanguagesModal'

const ItemActions = ({
  lang,
  onClickEdit
}: {
  lang: TranslateLanguageVo
  onClickEdit: (target: TranslateLanguageVo) => void
}) => {
  const { t } = useTranslation()
  // `rethrowError: false` — antd's Popconfirm closes after onConfirm regardless,
  // so rethrowing would only produce an unhandled rejection. The hook still logs
  // and toasts on failure.
  const deleteLanguage = useDeleteLanguage(lang.langCode, { rethrowError: false })
  return (
    <Space>
      <Button onClick={() => onClickEdit(lang)}>
        <EditOutlined />
        {t('common.edit')}
      </Button>
      <Popconfirm
        title={t('settings.translate.custom.delete.title')}
        description={t('settings.translate.custom.delete.description')}
        onConfirm={() => void deleteLanguage()}>
        <Button variant="destructive">
          <DeleteOutlined />
          {t('common.delete')}
        </Button>
      </Popconfirm>
    </Space>
  )
}

const TranslateLanguageSettings = () => {
  const { t } = useTranslation()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingLanguage, setEditingLanguage] = useState<TranslateLanguageVo>()
  const { languages } = useLanguages()

  const onClickAdd = () => {
    startTransition(async () => {
      setEditingLanguage(undefined)
      setIsModalOpen(true)
    })
  }

  const onClickEdit = (target: TranslateLanguageVo) => {
    startTransition(async () => {
      setEditingLanguage(target)
      setIsModalOpen(true)
    })
  }

  const onCancel = () => {
    startTransition(async () => {
      setIsModalOpen(false)
    })
  }

  const columns: TableProps<TranslateLanguageVo>['columns'] = useMemo(
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
          return <ItemActions lang={record} onClickEdit={onClickEdit} />
        }
      }
    ],
    [t]
  )

  return (
    <>
      <CustomLanguageSettingsContainer>
        <RowFlex className="justify-between py-1">
          <SettingRowTitle>{t('translate.custom.label')}</SettingRowTitle>
          <Button onClick={onClickAdd} style={{ marginBottom: 5, marginTop: -5 }}>
            <PlusOutlined size={16} />
            {t('common.add')}
          </Button>
        </RowFlex>
        <TableContainer>
          <Table<TranslateLanguageVo>
            columns={columns}
            pagination={{ position: ['bottomCenter'], defaultPageSize: 10 }}
            dataSource={languages}
          />
        </TableContainer>
      </CustomLanguageSettingsContainer>
      <TranslateLanguagesModal isOpen={isModalOpen} editingLanguage={editingLanguage} onCancel={onCancel} />
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

export default memo(TranslateLanguageSettings)
