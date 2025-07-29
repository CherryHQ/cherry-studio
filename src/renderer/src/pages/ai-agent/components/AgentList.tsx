import { List } from 'antd'
import { FC } from 'react'

const data = [
  {
    title: 'Unit Tests Bot',
  },
  {
    title: 'Security Scanner',
  },
  {
    title: 'Git Commit Bot',
  },
];

const AgentList: FC = () => {
  return (
    <List
      itemLayout="horizontal"
      dataSource={data}
      renderItem={(item, index) => (
        <List.Item>
          <List.Item.Meta
            title={<a href="https://ant.design">{item.title}</a>}
            description="Ant Design, a design language for background applications, is refined by Ant UED Team"
          />
        </List.Item>
      )}
    />
  )
}

export default AgentList