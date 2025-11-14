import { prefetch, useInvalidateCache, useMutation, usePaginatedQuery, useQuery } from '@renderer/data/hooks/useDataApi'
import { loggerService } from '@renderer/services/LoggerService'
import { Alert, Button, Card, Col, Input, message, Row, Space, Spin, Table, Tag, Typography } from 'antd'
import {
  ArrowLeft,
  ArrowRight,
  Database,
  Edit,
  Eye,
  GitBranch,
  Plus,
  RefreshCw,
  Trash2,
  TrendingUp,
  Zap
} from 'lucide-react'
import React, { useCallback, useState } from 'react'
import styled from 'styled-components'

const { Text } = Typography
const { TextArea } = Input

const logger = loggerService.withContext('DataApiHookTests')

interface TestItem {
  id: string
  title: string
  description: string
  status: string
  type: string
  priority: string
  tags: string[]
  createdAt: string
  updatedAt: string
  metadata: Record<string, any>
}

const DataApiHookTests: React.FC = () => {
  // Hook for cache invalidation
  const invalidateCache = useInvalidateCache()

  // State for manual testing
  const [selectedItemId, setSelectedItemId] = useState<string>('')
  const [newItemTitle, setNewItemTitle] = useState('')
  const [newItemDescription, setNewItemDescription] = useState('')
  const [updateTitle, setUpdateTitle] = useState('')
  const [updateDescription, setUpdateDescription] = useState('')
  const [queryParams, setQueryParams] = useState({ page: 1, limit: 5 })
  const [cacheTestCount, setCacheTestCount] = useState(0)

  // useQuery hook test - Basic data fetching
  const {
    data: itemsData,
    loading: itemsLoading,
    error: itemsError,
    refetch: refreshItems
  } = useQuery('/test/items' as any, {
    query: queryParams,
    swrOptions: {
      revalidateOnFocus: false,
      dedupingInterval: 2000
    }
  })

  // useQuery hook test - Single item by ID
  const {
    data: singleItem,
    loading: singleItemLoading,
    error: singleItemError,
    refetch: refreshSingleItem
  } = useQuery(selectedItemId ? `/test/items/${selectedItemId}` : (null as any), {
    enabled: !!selectedItemId,
    swrOptions: {
      revalidateOnFocus: false
    }
  })

  // usePaginatedQuery hook test
  const {
    items: paginatedItems,
    total: totalItems,
    page: currentPage,
    loading: paginatedLoading,
    error: paginatedError,
    hasMore,
    hasPrev,
    prevPage,
    nextPage,
    refresh: refreshPaginated,
    reset: resetPagination
  } = usePaginatedQuery('/test/items' as any, {
    query: { type: 'test' },
    limit: 3,
    swrOptions: {
      revalidateOnFocus: false
    }
  })

  // useMutation hook tests
  const createItemMutation = useMutation('POST', '/test/items', {
    onSuccess: (data) => {
      logger.info('Item created successfully', { data })
      message.success('Item created!')
      setNewItemTitle('')
      setNewItemDescription('')
      // Invalidate cache to refresh the list
      invalidateCache(['/test/items'])
    },
    onError: (error) => {
      logger.error('Failed to create item', error as Error)
      message.error(`Failed to create item: ${error.message}`)
    }
  })

  const updateItemMutation = useMutation(
    'PUT',
    selectedItemId ? `/test/items/${selectedItemId}` : '/test/items/placeholder',
    {
      onSuccess: (data) => {
        logger.info('Item updated successfully', { data })
        message.success('Item updated!')
        setUpdateTitle('')
        setUpdateDescription('')
        // Invalidate specific item and items list
        invalidateCache(['/test/items', ...(selectedItemId ? [`/test/items/${selectedItemId}`] : [])])
      },
      onError: (error) => {
        logger.error('Failed to update item', error as Error)
        message.error(`Failed to update item: ${error.message}`)
      }
    }
  )

  const deleteItemMutation = useMutation(
    'DELETE',
    selectedItemId ? `/test/items/${selectedItemId}` : '/test/items/placeholder',
    {
      onSuccess: () => {
        logger.info('Item deleted successfully')
        message.success('Item deleted!')
        setSelectedItemId('')
        // Invalidate cache
        invalidateCache(['/test/items'])
      },
      onError: (error) => {
        logger.error('Failed to delete item', error as Error)
        message.error(`Failed to delete item: ${error.message}`)
      }
    }
  )

  // useMutation with optimistic updates
  const optimisticUpdateMutation = useMutation(
    'PUT',
    selectedItemId ? `/test/items/${selectedItemId}` : '/test/items/placeholder',
    {
      optimistic: true,
      optimisticData: { title: 'Optimistically Updated Item' },
      revalidate: ['/test/items']
    }
  )

  // Handle functions
  const handleCreateItem = useCallback(async () => {
    if (!newItemTitle.trim()) {
      message.warning('Please enter an item title')
      return
    }

    try {
      await createItemMutation.mutate({
        body: {
          title: newItemTitle,
          description: newItemDescription,
          type: 'hook-test'
        }
      })
    } catch (error) {
      // Error already handled by mutation
    }
  }, [newItemTitle, newItemDescription, createItemMutation])

  const handleUpdateTopic = useCallback(async () => {
    if (!selectedItemId || !updateTitle.trim()) {
      message.warning('Please select an item and enter a title')
      return
    }

    try {
      await updateItemMutation.mutate({
        body: {
          title: updateTitle,
          description: updateDescription
        }
      })
    } catch (error) {
      // Error already handled by mutation
    }
  }, [selectedItemId, updateTitle, updateDescription, updateItemMutation])

  const handleDeleteTopic = useCallback(async () => {
    if (!selectedItemId) {
      message.warning('Please select an item to delete')
      return
    }

    try {
      await deleteItemMutation.mutate()
    } catch (error) {
      // Error already handled by mutation
    }
  }, [selectedItemId, deleteItemMutation])

  const handleOptimisticUpdate = useCallback(async () => {
    if (!selectedItemId || !singleItem) {
      message.warning('Please select an item for optimistic update')
      return
    }

    const optimisticData = {
      ...singleItem,
      title: `${(singleItem as any)?.title || 'Unknown'} (Optimistic Update)`,
      updatedAt: new Date().toISOString()
    }

    try {
      await optimisticUpdateMutation.mutate({
        body: {
          title: optimisticData.title,
          description: (singleItem as any)?.description
        }
      })
      message.success('Optimistic update completed!')
    } catch (error) {
      message.error(`Optimistic update failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [selectedItemId, singleItem, optimisticUpdateMutation])

  const handlePrefetch = useCallback(async () => {
    try {
      // Prefetch the next page of items
      await prefetch('/test/items', {
        query: { page: queryParams.page + 1, limit: queryParams.limit }
      })
      message.success('Next page prefetched!')
    } catch (error) {
      message.error('Prefetch failed')
    }
  }, [queryParams])

  const handleCacheTest = useCallback(async () => {
    // Test cache invalidation and refresh
    setCacheTestCount((prev) => prev + 1)

    if (cacheTestCount % 3 === 0) {
      await invalidateCache()
      message.info('All cache invalidated')
    } else if (cacheTestCount % 3 === 1) {
      await invalidateCache('/test/items')
      message.info('Topics cache invalidated')
    } else {
      refreshItems()
      message.info('Topics refreshed')
    }
  }, [cacheTestCount, refreshItems, invalidateCache])

  const itemsColumns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      render: (id: string) => (
        <Text code style={{ fontSize: 11 }}>
          {id.substring(0, 15)}...
        </Text>
      )
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true
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
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: TestItem) => (
        <Space>
          <Button
            size="small"
            type="link"
            icon={<Eye size={12} />}
            onClick={() => {
              setSelectedItemId(record.id)
              setUpdateTitle(record.title)
              setUpdateDescription((record as any).description || '')
            }}>
            Select
          </Button>
        </Space>
      )
    }
  ]

  return (
    <TestContainer>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Hook Status Overview */}
        <Row gutter={16}>
          <Col span={6}>
            <Card size="small">
              <Space direction="vertical" align="center" style={{ width: '100%' }}>
                <Database size={20} />
                <Text strong>useQuery</Text>
                {itemsLoading ? (
                  <Spin size="small" />
                ) : itemsError ? (
                  <Tag color="red">Error</Tag>
                ) : (
                  <Tag color="green">Active</Tag>
                )}
                <Text type="secondary">{(itemsData as any)?.items?.length || 0} items</Text>
              </Space>
            </Card>
          </Col>

          <Col span={6}>
            <Card size="small">
              <Space direction="vertical" align="center" style={{ width: '100%' }}>
                <TrendingUp size={20} />
                <Text strong>usePaginated</Text>
                {paginatedLoading ? (
                  <Spin size="small" />
                ) : paginatedError ? (
                  <Tag color="red">Error</Tag>
                ) : (
                  <Tag color="green">Active</Tag>
                )}
                <Text type="secondary">
                  {paginatedItems.length} / {totalItems}
                </Text>
              </Space>
            </Card>
          </Col>

          <Col span={6}>
            <Card size="small">
              <Space direction="vertical" align="center" style={{ width: '100%' }}>
                <GitBranch size={20} />
                <Text strong>useMutation</Text>
                {createItemMutation.loading || updateItemMutation.loading || deleteItemMutation.loading ? (
                  <Spin size="small" />
                ) : (
                  <Tag color="blue">Ready</Tag>
                )}
                <Text type="secondary">CRUD Operations</Text>
              </Space>
            </Card>
          </Col>

          <Col span={6}>
            <Card size="small">
              <Space direction="vertical" align="center" style={{ width: '100%' }}>
                <Zap size={20} />
                <Text strong>Cache</Text>
                <Tag color="purple">Active</Tag>
                <Text type="secondary">Test #{cacheTestCount}</Text>
              </Space>
            </Card>
          </Col>
        </Row>

        {/* useQuery Test - Basic Topics List */}
        <Card title="useQuery Hook Test - Topics List" size="small">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Row justify="space-between" align="middle">
              <Col>
                <Space>
                  <Text>Page: {queryParams.page}</Text>
                  <Text>Limit: {queryParams.limit}</Text>
                  {itemsLoading && <Spin size="small" />}
                </Space>
              </Col>
              <Col>
                <Space>
                  <Button size="small" icon={<RefreshCw size={14} />} onClick={refreshItems} loading={itemsLoading}>
                    Refresh
                  </Button>
                  <Button size="small" onClick={handlePrefetch}>
                    Prefetch Next
                  </Button>
                  <Button size="small" onClick={handleCacheTest}>
                    Cache Test
                  </Button>
                </Space>
              </Col>
            </Row>

            {itemsError ? (
              <Alert message="useQuery Error" description={itemsError.message} type="error" showIcon />
            ) : (
              <Table
                dataSource={(itemsData as any)?.items || []}
                columns={itemsColumns}
                rowKey="id"
                size="small"
                pagination={false}
                loading={itemsLoading}
                scroll={{ x: true }}
              />
            )}

            <Row justify="space-between">
              <Col>
                <Space>
                  <Button
                    size="small"
                    disabled={queryParams.page <= 1}
                    onClick={() => setQueryParams((prev) => ({ ...prev, page: prev.page - 1 }))}>
                    Previous
                  </Button>
                  <Button size="small" onClick={() => setQueryParams((prev) => ({ ...prev, page: prev.page + 1 }))}>
                    Next
                  </Button>
                </Space>
              </Col>
              <Col>
                <Text type="secondary">Total: {(itemsData as any)?.total || 0} items</Text>
              </Col>
            </Row>
          </Space>
        </Card>

        {/* Single Topic Query */}
        <Card title="useQuery Hook Test - Single Topic" size="small">
          <Row gutter={16}>
            <Col span={12}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Input
                  placeholder="Enter item ID"
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                />
                <Button
                  icon={<RefreshCw size={14} />}
                  onClick={refreshSingleItem}
                  loading={singleItemLoading}
                  disabled={!selectedItemId}
                  block>
                  Fetch Topic
                </Button>
              </Space>
            </Col>

            <Col span={12}>
              {singleItemLoading ? (
                <Spin />
              ) : singleItemError ? (
                <Alert message="Error" description={singleItemError.message} type="error" showIcon />
              ) : singleItem ? (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <div>
                    <strong>Title:</strong> {(singleItem as any)?.title || 'N/A'}
                  </div>
                  <div>
                    <strong>Type:</strong> <Tag>{(singleItem as any)?.type || 'N/A'}</Tag>
                  </div>
                  <div>
                    <strong>Status:</strong>{' '}
                    <Tag color={(singleItem as any)?.status === 'active' ? 'green' : 'orange'}>
                      {(singleItem as any)?.status || 'N/A'}
                    </Tag>
                  </div>
                  <div>
                    <strong>Updated:</strong> {new Date((singleItem as any)?.updatedAt || Date.now()).toLocaleString()}
                  </div>
                </Space>
              ) : (
                <Text type="secondary">No item selected</Text>
              )}
            </Col>
          </Row>
        </Card>

        {/* usePaginatedQuery Test */}
        <Card title="usePaginatedQuery Hook Test" size="small">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Row justify="space-between" align="middle">
              <Col>
                <Space>
                  <Text>Page: {currentPage}</Text>
                  <Text>Items: {paginatedItems.length}</Text>
                  <Text>Total: {totalItems}</Text>
                  {paginatedLoading && <Spin size="small" />}
                </Space>
              </Col>
              <Col>
                <Space>
                  <Button size="small" icon={<ArrowLeft size={14} />} onClick={prevPage} disabled={!hasPrev}>
                    Previous
                  </Button>
                  <Button size="small" icon={<ArrowRight size={14} />} onClick={nextPage} disabled={!hasMore}>
                    {hasMore ? 'Load More' : 'No More'}
                  </Button>
                  <Button size="small" icon={<RefreshCw size={14} />} onClick={refreshPaginated}>
                    Refresh
                  </Button>
                  <Button size="small" onClick={resetPagination}>
                    Reset
                  </Button>
                </Space>
              </Col>
            </Row>

            {paginatedError ? (
              <Alert message="usePaginatedQuery Error" description={paginatedError.message} type="error" showIcon />
            ) : (
              <div style={{ maxHeight: 300, overflow: 'auto' }}>
                {paginatedItems.map((item, index) => {
                  const typedItem = item as any
                  return (
                    <Card key={typedItem.id} size="small" style={{ marginBottom: 8 }}>
                      <Row justify="space-between" align="middle">
                        <Col span={18}>
                          <Space direction="vertical" size="small">
                            <Text strong>{typedItem.title}</Text>
                            <Space>
                              <Tag>{typedItem.type}</Tag>
                              <Tag color={typedItem.status === 'active' ? 'green' : 'orange'}>{typedItem.status}</Tag>
                            </Space>
                          </Space>
                        </Col>
                        <Col>
                          <Text type="secondary">#{index + 1}</Text>
                        </Col>
                      </Row>
                    </Card>
                  )
                })}
              </div>
            )}
          </Space>
        </Card>

        {/* useMutation Tests */}
        <Row gutter={16}>
          <Col span={12}>
            <Card title="useMutation - Create Topic" size="small">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Input
                  placeholder="Topic Title"
                  value={newItemTitle}
                  onChange={(e) => setNewItemTitle(e.target.value)}
                />
                <TextArea
                  placeholder="Topic Content (optional)"
                  value={newItemDescription}
                  onChange={(e) => setNewItemDescription(e.target.value)}
                  rows={3}
                />
                <Button
                  type="primary"
                  icon={<Plus size={14} />}
                  onClick={handleCreateItem}
                  loading={createItemMutation.loading}
                  disabled={!newItemTitle.trim()}
                  block>
                  Create Topic
                </Button>
                {createItemMutation.error && (
                  <Alert
                    message="Creation Error"
                    description={createItemMutation.error.message}
                    type="error"
                    showIcon
                    closable
                  />
                )}
              </Space>
            </Card>
          </Col>

          <Col span={12}>
            <Card title="useMutation - Update Topic" size="small">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Input placeholder="New Title" value={updateTitle} onChange={(e) => setUpdateTitle(e.target.value)} />
                <TextArea
                  placeholder="New Content"
                  value={updateDescription}
                  onChange={(e) => setUpdateDescription(e.target.value)}
                  rows={2}
                />
                <Space style={{ width: '100%' }}>
                  <Button
                    type="primary"
                    icon={<Edit size={14} />}
                    onClick={handleUpdateTopic}
                    loading={updateItemMutation.loading}
                    disabled={!selectedItemId || !updateTitle.trim()}>
                    Update
                  </Button>
                  <Button icon={<Zap size={14} />} onClick={handleOptimisticUpdate} disabled={!selectedItemId}>
                    Optimistic
                  </Button>
                  <Button
                    danger
                    icon={<Trash2 size={14} />}
                    onClick={handleDeleteTopic}
                    loading={deleteItemMutation.loading}
                    disabled={!selectedItemId}>
                    Delete
                  </Button>
                </Space>
                {(updateItemMutation.error || deleteItemMutation.error) && (
                  <Alert
                    message="Operation Error"
                    description={(updateItemMutation.error || deleteItemMutation.error)?.message}
                    type="error"
                    showIcon
                    closable
                  />
                )}
              </Space>
            </Card>
          </Col>
        </Row>
      </Space>
    </TestContainer>
  )
}

const TestContainer = styled.div`
  .ant-card {
    border-radius: 8px;
  }

  .ant-table-small .ant-table-tbody > tr > td {
    padding: 8px;
  }

  .ant-tag {
    border-radius: 4px;
  }
`

export default DataApiHookTests
