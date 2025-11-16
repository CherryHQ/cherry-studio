import { useMultiplePreferences } from '@renderer/data/hooks/usePreference'
import { Button, Card, Input, message, Select, Slider, Space, Table, Typography } from 'antd'
import type { ColumnType } from 'antd/es/table'
import React, { useState } from 'react'
import styled from 'styled-components'

const { Text } = Typography
const { Option } = Select

/**
 * usePreferences hook testing component
 * Tests multiple preferences management with batch operations
 */
const PreferenceMultipleTests: React.FC = () => {
  // Define different test scenarios
  const [scenario, setScenario] = useState<string>('basic')

  const scenarios = {
    basic: {
      theme: 'ui.theme_mode',
      language: 'app.language',
      zoom: 'app.zoom_factor'
    },
    ui: {
      theme: 'ui.theme_mode',
      zoom: 'app.zoom_factor',
      spell: 'app.spell_check.enabled'
    },
    user: {
      tray: 'app.tray.enabled',
      userName: 'app.user.name',
      devMode: 'app.developer_mode.enabled'
    },
    numbers: {
      zoomFactor: 'app.zoom_factor',
      fontSize: 'chat.message.font_size',
      opacity: 'feature.selection.action_window_opacity'
    },
    custom: {
      key1: 'ui.theme_mode',
      key2: 'app.language',
      key3: 'app.zoom_factor',
      key4: 'app.spell_check.enabled'
    }
  } as const

  const currentKeys = scenarios[scenario as keyof typeof scenarios]
  const [values, updateValues] = useMultiplePreferences(currentKeys)

  const [batchInput, setBatchInput] = useState<string>('')

  const handleBatchUpdate = async () => {
    try {
      const updates = JSON.parse(batchInput)
      await updateValues(updates)
      message.success('批量更新成功')
      setBatchInput('')
    } catch (error) {
      if (error instanceof SyntaxError) {
        message.error('JSON格式错误')
      } else {
        message.error(`更新失败: ${(error as Error).message}`)
      }
    }
  }

  const handleQuickUpdate = async (key: string, value: any) => {
    try {
      await updateValues({ [key]: value })
      message.success(`${key} 更新成功`)
    } catch (error) {
      message.error(`更新失败: ${(error as Error).message}`)
    }
  }

  const generateSampleBatch = () => {
    const sampleUpdates: Record<string, any> = {}
    Object.keys(currentKeys).forEach((localKey, index) => {
      const prefKey = currentKeys[localKey as keyof typeof currentKeys]

      switch (prefKey) {
        case 'ui.theme_mode':
          sampleUpdates[localKey] = values[localKey] === 'ThemeMode.dark' ? 'ThemeMode.light' : 'ThemeMode.dark'
          break
        case 'app.language':
          sampleUpdates[localKey] = values[localKey] === 'zh-CN' ? 'en-US' : 'zh-CN'
          break
        case 'app.zoom_factor':
          sampleUpdates[localKey] = 1.0 + index * 0.1
          break
        case 'app.spell_check.enabled':
          sampleUpdates[localKey] = !values[localKey]
          break
        case 'chat.message.font_size':
          sampleUpdates[localKey] = 14 + index * 2
          break
        case 'feature.selection.action_window_opacity':
          sampleUpdates[localKey] = 80 + index * 10
          break
        default:
          sampleUpdates[localKey] = `sample_value_${index}`
      }
    })

    setBatchInput(JSON.stringify(sampleUpdates, null, 2))
  }

  // Table columns for displaying values
  const columns: ColumnType<any>[] = [
    {
      title: '本地键名',
      dataIndex: 'localKey',
      key: 'localKey',
      width: 120
    },
    {
      title: '偏好设置键',
      dataIndex: 'prefKey',
      key: 'prefKey',
      width: 200
    },
    {
      title: '当前值',
      dataIndex: 'value',
      key: 'value',
      render: (value: any) => (
        <ValueDisplay>
          {value !== undefined ? (
            typeof value === 'object' ? (
              JSON.stringify(value)
            ) : (
              String(value)
            )
          ) : (
            <Text type="secondary">undefined</Text>
          )}
        </ValueDisplay>
      )
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 80,
      render: (type: string) => <Text code>{type}</Text>
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_, record) => (
        <Space size="small">
          {record.prefKey === 'ui.theme_mode' && (
            <Button
              size="small"
              onClick={() =>
                handleQuickUpdate(
                  record.localKey,
                  record.value === 'ThemeMode.dark' ? 'ThemeMode.light' : 'ThemeMode.dark'
                )
              }>
              切换
            </Button>
          )}
          {record.prefKey === 'app.spell_check.enabled' && (
            <Button size="small" onClick={() => handleQuickUpdate(record.localKey, !record.value)}>
              切换
            </Button>
          )}
          {record.prefKey === 'app.language' && (
            <Button
              size="small"
              onClick={() => handleQuickUpdate(record.localKey, record.value === 'zh-CN' ? 'en-US' : 'zh-CN')}>
              切换
            </Button>
          )}
        </Space>
      )
    }
  ]

  // Transform data for table
  const tableData = Object.keys(currentKeys).map((localKey, index) => ({
    key: index,
    localKey,
    prefKey: currentKeys[localKey as keyof typeof currentKeys],
    value: values[localKey],
    type: typeof values[localKey]
  }))

  return (
    <TestContainer>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {/* Scenario Selection */}
        <Card size="small" title="测试场景选择">
          <Space align="center" wrap>
            <Text>选择测试场景:</Text>
            <Select value={scenario} onChange={setScenario} style={{ width: 250 }}>
              <Option value="basic">基础设置 (theme, language, zoom)</Option>
              <Option value="ui">UI设置 (theme, zoom, spell)</Option>
              <Option value="user">用户设置 (tray, userName, devMode)</Option>
              <Option value="numbers">🎛️ 数值设置 (zoom, fontSize, selection opacity)</Option>
              <Option value="custom">自定义组合 (4项设置)</Option>
            </Select>
            <Text type="secondary">当前映射: {Object.keys(currentKeys).length} 项</Text>
          </Space>
        </Card>

        {/* Current Values Table */}
        <Card size="small" title="当前值状态">
          <Table columns={columns} dataSource={tableData} pagination={false} size="small" bordered />
        </Card>

        {/* Interactive Slider Controls for Numbers Scenario */}
        {scenario === 'numbers' && (
          <Card size="small" title="🎛️ 实时Slider联动控制" style={{ backgroundColor: '#f0f8ff' }}>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Text type="secondary">拖动任一滑块，观察其他窗口中相同偏好设置的实时同步变化</Text>

              {/* Zoom Factor Slider */}
              <div>
                <Text strong>
                  缩放因子:{' '}
                  {Math.round(
                    (typeof (values as any).zoomFactor === 'number' ? (values as any).zoomFactor : 1.0) * 100
                  )}
                  %
                </Text>
                <Slider
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  value={typeof (values as any).zoomFactor === 'number' ? (values as any).zoomFactor : 1.0}
                  onChange={(val) => updateValues({ zoomFactor: val } as any)}
                  marks={{
                    0.5: '50%',
                    1.0: '100%',
                    1.5: '150%',
                    2.0: '200%'
                  }}
                  tooltip={{ formatter: (val) => `${Math.round((val || 1) * 100)}%` }}
                />
              </div>

              {/* Font Size Slider */}
              <div>
                <Text strong>
                  字体大小: {typeof (values as any).fontSize === 'number' ? (values as any).fontSize : 14}px
                </Text>
                <Slider
                  min={8}
                  max={72}
                  step={1}
                  value={typeof (values as any).fontSize === 'number' ? (values as any).fontSize : 14}
                  onChange={(val) => updateValues({ fontSize: val } as any)}
                  marks={{
                    8: '8px',
                    12: '12px',
                    16: '16px',
                    24: '24px',
                    36: '36px',
                    72: '72px'
                  }}
                  tooltip={{ formatter: (val) => `${val}px` }}
                />
              </div>

              {/* Selection Window Opacity Slider */}
              <div>
                <Text strong>
                  选择窗口透明度:{' '}
                  {Math.round(typeof (values as any).opacity === 'number' ? (values as any).opacity : 100)}%
                </Text>
                <Slider
                  min={10}
                  max={100}
                  step={5}
                  value={typeof (values as any).opacity === 'number' ? (values as any).opacity : 100}
                  onChange={(val) => updateValues({ opacity: val } as any)}
                  marks={{
                    10: '10%',
                    30: '30%',
                    50: '50%',
                    70: '70%',
                    90: '90%',
                    100: '100%'
                  }}
                  tooltip={{ formatter: (val) => `${Math.round(val || 100)}%` }}
                />
              </div>

              <div style={{ padding: '8px', backgroundColor: '#e6f7ff', borderRadius: '4px' }}>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  💡 测试提示：同时拖动多个滑块，观察另一个测试窗口中的同步效果！
                </Text>
              </div>
            </Space>
          </Card>
        )}

        {/* Batch Update */}
        <Card size="small" title="批量更新">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Space>
              <Button onClick={generateSampleBatch}>生成示例更新</Button>
              <Button type="primary" onClick={handleBatchUpdate} disabled={!batchInput.trim()}>
                执行批量更新
              </Button>
            </Space>

            <Input.TextArea
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
              placeholder='输入JSON格式的批量更新数据，例如: {"theme": "dark", "language": "en-US"}'
              rows={6}
              style={{ fontFamily: 'monospace' }}
            />

            <Text type="secondary" style={{ fontSize: '12px' }}>
              格式: &#123;"localKey": "newValue", ...&#125; - 使用本地键名，不是完整的偏好设置键名
            </Text>
          </Space>
        </Card>

        {/* Quick Actions */}
        <Card size="small" title="快速操作">
          <Space wrap>
            <Button
              onClick={() =>
                updateValues(Object.fromEntries(Object.keys(currentKeys).map((key) => [key, 'test_value'])))
              }>
              设置所有为测试值
            </Button>
            <Button
              onClick={() => updateValues(Object.fromEntries(Object.keys(currentKeys).map((key) => [key, undefined])))}>
              清空所有值
            </Button>
            <Button
              onClick={async () => {
                const toggles: Record<string, any> = {}
                Object.entries(currentKeys).forEach(([localKey, prefKey]) => {
                  if (prefKey === 'ui.theme_mode') {
                    toggles[localKey] = values[localKey] === 'ThemeMode.dark' ? 'ThemeMode.light' : 'ThemeMode.dark'
                  } else if (prefKey === 'app.spell_check.enabled') {
                    toggles[localKey] = !values[localKey]
                  }
                })
                if (Object.keys(toggles).length > 0) {
                  await updateValues(toggles)
                  message.success('切换操作完成')
                }
              }}>
              切换布尔/主题值
            </Button>
          </Space>
        </Card>

        {/* Hook Info */}
        <Card size="small" title="Hook 信息">
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Text>
              本地键映射: <Text code>{JSON.stringify(currentKeys, null, 2)}</Text>
            </Text>
            <Text>
              返回值数量: <Text strong>{Object.keys(values).length}</Text>
            </Text>
            <Text>
              已定义值: <Text strong>{Object.values(values).filter((v) => v !== undefined).length}</Text>
            </Text>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              usePreferences 返回的值对象使用本地键名，内部自动映射到实际的偏好设置键
            </Text>
          </Space>
        </Card>
      </Space>
    </TestContainer>
  )
}

const TestContainer = styled.div`
  padding: 16px;
  background: #fafafa;
  border-radius: 8px;
`

const ValueDisplay = styled.span`
  font-family: 'Courier New', monospace;
  font-size: 12px;
  word-break: break-all;
`

export default PreferenceMultipleTests
