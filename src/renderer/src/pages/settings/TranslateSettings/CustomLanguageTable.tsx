import { CustomTranslateLanguage } from '@renderer/types'
import { Table } from 'antd'
import { memo, use } from 'react'

type Props = {
  dataPromise: Promise<CustomTranslateLanguage[]>
}

const CustomLanguageTable = ({ dataPromise }: Props) => {
  const columns = [
    {
      title: 'Emoji'
    },
    {
      title: 'Value'
    },
    {
      title: 'langCode'
    }
  ]

  const data = use(dataPromise)

  return (
    <Table<CustomTranslateLanguage> columns={columns} pagination={{ position: ['bottomCenter'] }} dataSource={data} />
  )
}

export default memo(CustomLanguageTable)
