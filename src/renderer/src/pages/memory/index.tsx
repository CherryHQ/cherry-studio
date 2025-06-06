import { FrownOutlined, MehOutlined, ReloadOutlined, SettingOutlined, SmileOutlined } from '@ant-design/icons'
import { Button, Col, DatePicker, Form, Input, Layout, Row, Select, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { useState } from 'react'

import MemoriesSettingsModal from './settings-modal'

const { Content } = Layout
const { Title, Text } = Typography
const { RangePicker } = DatePicker
const { Option } = Select

// Sample Data (replace with your actual data source)
const initialData = [
  {
    key: '1',
    time: '1 day ago',
    userInfo: 'alex',
    memory: 'Is allergic to nuts',
    categories: ['health'],
    feedback: ['happy', 'neutral'] // Using strings to map to icons
  },
  {
    key: '2',
    time: '1 day ago',
    userInfo: 'alex',
    memory: 'Is a vegetarian',
    categories: ['user_preferences', 'food'],
    feedback: ['happy', 'neutral', 'sad']
  },
  {
    key: '3',
    time: '1 day ago',
    userInfo: 'alex',
    memory: 'User name is Alex',
    categories: ['personal_details'],
    feedback: ['happy', 'neutral']
  }
  // Add more memory objects here
]

const renderFeedbackIcons = (feedback) => (
  <Space>
    {feedback.includes('happy') && (
      <Tooltip title="Happy">
        <SmileOutlined style={{ color: '#52c41a' }} />
      </Tooltip>
    )}
    {feedback.includes('neutral') && (
      <Tooltip title="Neutral">
        <MehOutlined style={{ color: '#faad14' }} />
      </Tooltip>
    )}
    {feedback.includes('sad') && (
      <Tooltip title="Sad">
        <FrownOutlined style={{ color: '#f5222d' }} />
      </Tooltip>
    )}
  </Space>
)

const MemoriesPage = () => {
  const [dataSource, setDataSource] = useState(initialData)
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [searchText, setSearchText] = useState('')
  const [dateRange, setDateRange] = useState(null)
  const [selectedUser, setSelectedUser] = useState('all') // 'all' or a specific user ID
  const [settingsModalVisible, setSettingsModalVisible] = useState(false)
  const [form] = Form.useForm()

  // --- Filter Logic (Basic examples, expand as needed) ---
  const handleSearch = (e) => {
    const value = e.target.value.toLowerCase()
    setSearchText(value)
    filterData(value, dateRange, selectedUser)
  }

  const handleDateChange = (dates) => {
    setDateRange(dates)
    filterData(searchText, dates, selectedUser)
  }

  const handleUserChange = (value) => {
    setSelectedUser(value)
    filterData(searchText, dateRange, value)
  }

  const filterData = (currentSearchText, currentDateRange, currentSelectedUser) => {
    let filteredData = initialData

    // Search text filter
    if (currentSearchText) {
      filteredData = filteredData.filter((item) =>
        Object.values(item).some((val) => String(val).toLowerCase().includes(currentSearchText))
      )
    }

    // Date range filter (This is a placeholder, implement actual date filtering logic)
    if (currentDateRange && currentDateRange.length === 2) {
      // Example: filter based on 'time' if it were a date object
      // For '1 day ago' type strings, you'd need more complex parsing
      console.log('Date range filtering not fully implemented for string dates.')
    }

    // User filter
    if (currentSelectedUser !== 'all') {
      filteredData = filteredData.filter((item) => item.userInfo === currentSelectedUser)
    }

    setDataSource(filteredData)
  }

  const resetFilters = () => {
    setSearchText('')
    setDateRange(null)
    setSelectedUser('all')
    setDataSource(initialData)
    // Clear AntD component states if necessary (e.g., Input value)
    // For controlled components, clearing the state variable is enough.
  }

  const handleSettingsSubmit = (values) => {
    console.log('Settings saved:', values)
    // Here you would typically save the settings to your backend or local storage
    setSettingsModalVisible(false)
  }

  const handleSettingsCancel = () => {
    setSettingsModalVisible(false)
    form.resetFields()
  }

  const columns = [
    {
      title: 'Time',
      dataIndex: 'time',
      key: 'time',
      sorter: (a, b) => {
        // Basic sorter, for '1 day ago' you'd need custom logic
        // This won't sort "1 day ago" correctly without parsing.
        // For real date objects, this would be: new Date(a.time) - new Date(b.time)
        return a.time.localeCompare(b.time)
      }
    },
    {
      title: 'User Info',
      dataIndex: 'userInfo',
      key: 'userInfo',
      render: (text) => <Tag color="blue">{text}</Tag>,
      filters: [
        // Example filters, populate dynamically if needed
        { text: 'alex', value: 'alex' }
        // Add other user names
      ],
      onFilter: (value, record) => record.userInfo.indexOf(value) === 0
    },
    {
      title: 'Memory',
      dataIndex: 'memory',
      key: 'memory'
    },
    {
      title: 'Categories',
      dataIndex: 'categories',
      key: 'categories',
      render: (categories) => (
        <>
          {categories.map((category) => {
            let color = category.length > 10 ? 'geekblue' : 'green'
            if (category === 'health') color = 'volcano'
            if (category === 'food') color = 'gold'
            if (category === 'personal_details') color = 'purple'
            return (
              <Tag color={color} key={category}>
                {category.toUpperCase()}
              </Tag>
            )
          })}
        </>
      )
      // Add filter capabilities for categories if needed
    },
    {
      title: 'Feedback',
      dataIndex: 'feedback',
      key: 'feedback',
      render: renderFeedbackIcons
    }
  ]

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys)
  }

  return (
    <Layout style={{ minHeight: '100vh', backgroundColor: '#f0f2f5' }}>
      <Content style={{ padding: '24px 50px' }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {/* Header Section */}
          <Row justify="space-between" align="middle">
            <Col>
              <Title level={2} style={{ margin: 0 }}>
                Memories
              </Title>
              <Text type="secondary">A summary of your memories</Text>
            </Col>
            <Col>
              <Space>
                <Tooltip title="Settings">
                  <Button shape="circle" icon={<SettingOutlined />} onClick={() => setSettingsModalVisible(true)} />
                </Tooltip>
                <Tooltip title="Refresh">
                  <Button
                    shape="circle"
                    icon={<ReloadOutlined />}
                    onClick={() => filterData(searchText, dateRange, selectedUser)}
                  />
                </Tooltip>
              </Space>
            </Col>
          </Row>

          {/* Filter Section */}
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} md={8} lg={6}>
              <Input placeholder="Search memories..." value={searchText} onChange={handleSearch} allowClear />
            </Col>
            <Col xs={24} sm={12} md={8} lg={6}>
              <RangePicker style={{ width: '100%' }} value={dateRange} onChange={handleDateChange} />
            </Col>
            <Col xs={24} sm={12} md={8} lg={6}>
              <Select defaultValue="all" style={{ width: '100%' }} onChange={handleUserChange} value={selectedUser}>
                <Option value="all">All Users (1 of 1)</Option> {/* Make this dynamic */}
                <Option value="alex">Alex</Option>
                {/* Add other users dynamically */}
              </Select>
            </Col>
            <Col xs={24} sm={12} md={24} lg={6} style={{ textAlign: 'right' }}>
              <Button onClick={resetFilters}>Reset Filters</Button>
            </Col>
          </Row>

          {/* Table Section */}
          <Table
            rowSelection={rowSelection}
            columns={columns}
            dataSource={dataSource}
            pagination={{ pageSize: 10, showSizeChanger: true }} // Example pagination
            bordered
          />
        </Space>

        {/* Settings Modal */}
        <MemoriesSettingsModal
          visible={settingsModalVisible}
          onSubmit={handleSettingsSubmit}
          onCancel={handleSettingsCancel}
          form={form}
        />
      </Content>
    </Layout>
  )
}

export default MemoriesPage
