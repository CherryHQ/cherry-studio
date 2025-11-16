import { loggerService } from '@renderer/services/LoggerService'
import { Alert, Button, Card, Col, Divider, Input, message, Row, Space, Table, Tag, Typography } from 'antd'
import { Check, Database, Play, RotateCcw, X } from 'lucide-react'
import React, { useState } from 'react'
import styled from 'styled-components'

import { dataApiService } from '../../../data/DataApiService'

const { Text, Paragraph } = Typography
const { TextArea } = Input

const logger = loggerService.withContext('DataApiBasicTests')

interface TestResult {
  id: string
  name: string
  status: 'pending' | 'running' | 'success' | 'error'
  duration?: number
  response?: any
  error?: string
  timestamp?: string
}

interface TestItem {
  id: string
  title: string
  description: string
  type: string
  status: string
  priority: string
  tags: string[]
  createdAt: string
  updatedAt: string
  metadata: Record<string, any>
}

const DataApiBasicTests: React.FC = () => {
  const [testResults, setTestResults] = useState<TestResult[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [testItems, setTestItems] = useState<TestItem[]>([])
  const [selectedItem, setSelectedItem] = useState<TestItem | null>(null)
  const [newItemTitle, setNewItemTitle] = useState('')
  const [newItemDescription, setNewItemDescription] = useState('')
  const [newItemType, setNewItemType] = useState('data')

  const updateTestResult = (id: string, updates: Partial<TestResult>) => {
    setTestResults((prev) => prev.map((result) => (result.id === id ? { ...result, ...updates } : result)))
  }

  const runTest = async (testId: string, testName: string, testFn: () => Promise<any>) => {
    const startTime = Date.now()

    updateTestResult(testId, {
      status: 'running',
      timestamp: new Date().toISOString()
    })

    try {
      logger.info(`Starting test: ${testName}`)
      const response = await testFn()
      const duration = Date.now() - startTime

      logger.info(`Test completed: ${testName}`, { duration, response })

      updateTestResult(testId, {
        status: 'success',
        duration,
        response,
        error: undefined
      })

      message.success(`${testName} completed successfully`)
      return response
    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      logger.error(`Test failed: ${testName}`, error as Error)

      updateTestResult(testId, {
        status: 'error',
        duration,
        error: errorMessage,
        response: undefined
      })

      message.error(`${testName} failed: ${errorMessage}`)
      throw error
    }
  }

  const initializeTests = () => {
    const tests: TestResult[] = [
      { id: 'get-items', name: 'GET /test/items', status: 'pending' },
      { id: 'create-item', name: 'POST /test/items', status: 'pending' },
      { id: 'get-item-by-id', name: 'GET /test/items/:id', status: 'pending' },
      { id: 'update-item', name: 'PUT /test/items/:id', status: 'pending' },
      { id: 'delete-item', name: 'DELETE /test/items/:id', status: 'pending' },
      { id: 'search-items', name: 'GET /test/search', status: 'pending' },
      { id: 'get-stats', name: 'GET /test/stats', status: 'pending' }
    ]

    setTestResults(tests)
    setTestItems([])
    setSelectedItem(null)
  }

  const runAllTests = async () => {
    if (isRunning) return

    setIsRunning(true)
    initializeTests()

    try {
      // Test 1: Get test items list
      const itemsResponse = await runTest('get-items', 'Get Test Items List', () => dataApiService.get('/test/items'))
      setTestItems(itemsResponse.items || [])

      // Test 2: Create a new test item
      const newItem = {
        title: `Test Item ${Date.now()}`,
        description: 'This is a test item created by the DataApi test suite',
        type: 'data',
        status: 'active',
        priority: 'medium',
        tags: ['test', 'api'],
        metadata: { source: 'test-suite', version: '1.0.0' }
      }

      const createResponse = await runTest('create-item', 'Create New Test Item', () =>
        dataApiService.post('/test/items', { body: newItem })
      )

      // Debug: Log the create response
      logger.info('Create response received', { createResponse, id: createResponse?.id })

      // Update items list with new item
      if (createResponse) {
        setTestItems((prev) => [createResponse, ...prev])
        setSelectedItem(createResponse)
      }

      // Test 3: Get item by ID
      if (createResponse?.id) {
        logger.info('About to test get item by ID', { id: createResponse.id })
        await runTest('get-item-by-id', 'Get Test Item By ID', () =>
          dataApiService.get(`/test/items/${createResponse.id}`)
        )
      } else {
        logger.warn('Skipping get item by ID test - no valid item ID from create response', { createResponse })
        updateTestResult('get-item-by-id', {
          status: 'error',
          error: 'No valid item ID from create response'
        })
      }

      // Only proceed with update/delete if we have a valid ID
      if (createResponse?.id) {
        // Test 4: Update item
        const updatedData = {
          title: `${createResponse.title} (Updated)`,
          description: `${createResponse.description}\n\nUpdated by test at ${new Date().toISOString()}`,
          priority: 'high'
        }

        const updateResponse = await runTest('update-item', 'Update Test Item', () =>
          dataApiService.put(`/test/items/${createResponse.id}`, {
            body: updatedData
          })
        )

        if (updateResponse) {
          setSelectedItem(updateResponse)
          setTestItems((prev) => prev.map((item) => (item.id === createResponse.id ? updateResponse : item)))
        }
      }

      // Test 5: Search items
      await runTest('search-items', 'Search Test Items', () =>
        dataApiService.get('/test/search', {
          query: {
            query: 'test',
            page: 1,
            limit: 10
          }
        })
      )

      // Test 6: Get statistics
      await runTest('get-stats', 'Get Test Statistics', () => dataApiService.get('/test/stats'))

      // Test 7: Delete item (optional, comment out to keep test data)
      // if (createResponse?.id) {
      //   await runTest(
      //     'delete-item',
      //     'Delete Test Item',
      //     () => dataApiService.delete(`/test/items/${createResponse.id}`)
      //   )
      // }

      message.success('All basic tests completed!')
    } catch (error) {
      logger.error('Test suite failed', error as Error)
      message.error('Test suite execution failed')
    } finally {
      setIsRunning(false)
    }
  }

  const runSingleTest = async (testId: string) => {
    if (isRunning) return

    switch (testId) {
      case 'create-item': {
        if (!newItemTitle.trim()) {
          message.warning('Please enter an item title')
          return
        }

        const createResponse = await runTest(testId, 'Create New Item', () =>
          dataApiService.post('/test/items', {
            body: {
              title: newItemTitle,
              description: newItemDescription,
              type: newItemType
            }
          })
        )

        if (createResponse) {
          setTestItems((prev) => [createResponse, ...prev])
          setNewItemTitle('')
          setNewItemDescription('')
        }
        break
      }

      default:
        message.warning(`Single test execution not implemented for ${testId}`)
    }
  }

  const resetTests = () => {
    setTestResults([])
    setTestItems([])
    setSelectedItem(null)
    setNewItemTitle('')
    setNewItemDescription('')
    message.info('Tests reset')
  }

  const resetTestData = async () => {
    try {
      await dataApiService.post('/test/reset', {})
      message.success('Test data reset successfully')
      setTestItems([])
      setSelectedItem(null)
    } catch (error) {
      logger.error('Failed to reset test data', error as Error)
      message.error('Failed to reset test data')
    }
  }

  const getStatusColor = (status: TestResult['status']) => {
    switch (status) {
      case 'success':
        return 'success'
      case 'error':
        return 'error'
      case 'running':
        return 'processing'
      default:
        return 'default'
    }
  }

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'success':
        return <Check size={16} />
      case 'error':
        return <X size={16} />
      case 'running':
        return <RotateCcw size={16} className="animate-spin" />
      default:
        return null
    }
  }

  const tableColumns = [
    {
      title: 'Test',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text code>{name}</Text>
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: TestResult['status']) => (
        <Tag color={getStatusColor(status)} icon={getStatusIcon(status)}>
          {status.toUpperCase()}
        </Tag>
      )
    },
    {
      title: 'Duration',
      dataIndex: 'duration',
      key: 'duration',
      render: (duration?: number) => (duration ? `${duration}ms` : '-')
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: TestResult) => (
        <Button
          size="small"
          type="link"
          icon={<Play size={14} />}
          onClick={() => runSingleTest(record.id)}
          disabled={isRunning}>
          Run
        </Button>
      )
    }
  ]

  const itemsColumns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      render: (id: string) => <Text code>{id.substring(0, 20)}...</Text>
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title'
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => <Tag>{type}</Tag>
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => <Tag color={status === 'active' ? 'green' : 'orange'}>{status}</Tag>
    },
    {
      title: 'Priority',
      dataIndex: 'priority',
      key: 'priority',
      render: (priority: string) => (
        <Tag color={priority === 'high' ? 'red' : priority === 'medium' ? 'orange' : 'blue'}>{priority}</Tag>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: TestItem) => (
        <Button size="small" type="link" onClick={() => setSelectedItem(record)}>
          View
        </Button>
      )
    }
  ]

  return (
    <TestContainer>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Control Panel */}
        <Card size="small">
          <Row gutter={16} align="middle">
            <Col span={12}>
              <Space>
                <Button
                  type="primary"
                  icon={<Play size={16} />}
                  onClick={runAllTests}
                  loading={isRunning}
                  disabled={isRunning}>
                  Run All Basic Tests
                </Button>
                <Button icon={<RotateCcw size={16} />} onClick={resetTests} disabled={isRunning}>
                  Reset Tests
                </Button>
              </Space>
            </Col>
            <Col span={12}>
              <Space style={{ float: 'right' }}>
                <Button icon={<Database size={16} />} onClick={resetTestData} disabled={isRunning}>
                  Reset Test Data
                </Button>
              </Space>
            </Col>
          </Row>
        </Card>

        {/* Test Results */}
        <Card title="Test Results" size="small">
          {testResults.length === 0 ? (
            <Alert
              message="No tests executed yet"
              description="Click 'Run All Basic Tests' to start testing basic CRUD operations"
              type="info"
              showIcon
            />
          ) : (
            <Table
              dataSource={testResults}
              columns={tableColumns}
              rowKey="id"
              size="small"
              pagination={false}
              scroll={{ x: true }}
            />
          )}
        </Card>

        {/* Manual Testing */}
        <Row gutter={16}>
          <Col span={12}>
            <Card title="Create Item Manually" size="small">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Input
                  placeholder="Item Title"
                  value={newItemTitle}
                  onChange={(e) => setNewItemTitle(e.target.value)}
                />
                <TextArea
                  placeholder="Item Description (optional)"
                  value={newItemDescription}
                  onChange={(e) => setNewItemDescription(e.target.value)}
                  rows={3}
                />
                <Input placeholder="Item Type" value={newItemType} onChange={(e) => setNewItemType(e.target.value)} />
                <Button
                  type="primary"
                  onClick={() => runSingleTest('create-item')}
                  disabled={isRunning || !newItemTitle.trim()}
                  block>
                  Create Item
                </Button>
              </Space>
            </Card>
          </Col>

          <Col span={12}>
            <Card title="Selected Item Details" size="small">
              {selectedItem ? (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <div>
                    <strong>ID:</strong> <Text code>{selectedItem.id}</Text>
                  </div>
                  <div>
                    <strong>Title:</strong> {selectedItem.title}
                  </div>
                  <div>
                    <strong>Type:</strong> <Tag>{selectedItem.type}</Tag>
                  </div>
                  <div>
                    <strong>Status:</strong>{' '}
                    <Tag color={selectedItem.status === 'active' ? 'green' : 'orange'}>{selectedItem.status}</Tag>
                  </div>
                  <div>
                    <strong>Priority:</strong>{' '}
                    <Tag
                      color={
                        selectedItem.priority === 'high'
                          ? 'red'
                          : selectedItem.priority === 'medium'
                            ? 'orange'
                            : 'blue'
                      }>
                      {selectedItem.priority}
                    </Tag>
                  </div>
                  <div>
                    <strong>Created:</strong> {new Date(selectedItem.createdAt).toLocaleString()}
                  </div>
                  {selectedItem.description && (
                    <div>
                      <strong>Description:</strong>
                      <Paragraph ellipsis={{ rows: 3, expandable: true }}>{selectedItem.description}</Paragraph>
                    </div>
                  )}
                  {selectedItem.tags && selectedItem.tags.length > 0 && (
                    <div>
                      <strong>Tags:</strong>{' '}
                      {selectedItem.tags.map((tag: string) => (
                        <Tag key={tag}>{tag}</Tag>
                      ))}
                    </div>
                  )}
                </Space>
              ) : (
                <Text type="secondary">No item selected</Text>
              )}
            </Card>
          </Col>
        </Row>

        {/* Items Table */}
        <Card title={`Test Items (${testItems.length})`} size="small">
          {testItems.length === 0 ? (
            <Alert
              message="No items loaded"
              description="Run the tests or create a new item to see data here"
              type="info"
              showIcon
            />
          ) : (
            <Table
              dataSource={testItems}
              columns={itemsColumns}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 10 }}
              scroll={{ x: true }}
            />
          )}
        </Card>

        {/* Test Details */}
        {testResults.some((t) => t.response || t.error) && (
          <Card title="Test Details" size="small">
            <Space direction="vertical" style={{ width: '100%' }}>
              {testResults.map(
                (result) =>
                  (result.response || result.error) && (
                    <div key={result.id}>
                      <Divider orientation="left" plain>
                        <Text code>{result.name}</Text> -
                        <Tag color={getStatusColor(result.status)}>{result.status}</Tag>
                      </Divider>
                      {result.response && (
                        <div>
                          <Text strong>Response:</Text>
                          <pre
                            style={{
                              background: '#f5f5f5',
                              padding: 8,
                              borderRadius: 4,
                              fontSize: 12,
                              overflow: 'auto'
                            }}>
                            {JSON.stringify(result.response, null, 2)}
                          </pre>
                        </div>
                      )}
                      {result.error && (
                        <div>
                          <Text strong type="danger">
                            Error:
                          </Text>
                          <pre
                            style={{
                              background: '#fff2f0',
                              padding: 8,
                              borderRadius: 4,
                              fontSize: 12,
                              overflow: 'auto',
                              border: '1px solid #ffccc7'
                            }}>
                            {result.error}
                          </pre>
                        </div>
                      )}
                    </div>
                  )
              )}
            </Space>
          </Card>
        )}
      </Space>
    </TestContainer>
  )
}

const TestContainer = styled.div`
  .animate-spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  pre {
    margin: 8px 0;
    max-height: 200px;
  }
`

export default DataApiBasicTests
