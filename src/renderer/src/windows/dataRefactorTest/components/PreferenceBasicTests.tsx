import { Switch } from '@cherrystudio/ui'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { type PreferenceKeyType, ThemeMode } from '@shared/data/preference/preferenceTypes'
import { Button, Input, message, Select, Slider, Space, Typography } from 'antd'
import React, { useState } from 'react'
import styled from 'styled-components'

const { Text } = Typography
const { Option } = Select

/**
 * Basic usePreference hook testing component
 * Tests single preference management with React hooks
 */
const PreferenceBasicTests: React.FC = () => {
  const [selectedKey, setSelectedKey] = useState<PreferenceKeyType>('ui.theme_mode')

  // Use the hook with the selected key
  const [value, setValue] = usePreference(selectedKey)

  const [inputValue, setInputValue] = useState<string>('')

  // Add theme monitoring for visual changes
  const [currentTheme] = usePreference('ui.theme_mode')
  const isDarkTheme = currentTheme === ThemeMode.dark

  const handleSetValue = async () => {
    try {
      let parsedValue: any = inputValue

      // Try to parse as JSON if it looks like an object/array/boolean/number
      if (
        inputValue.startsWith('{') ||
        inputValue.startsWith('[') ||
        inputValue === 'true' ||
        inputValue === 'false' ||
        !isNaN(Number(inputValue))
      ) {
        try {
          parsedValue = JSON.parse(inputValue)
        } catch {
          // Keep as string if JSON parsing fails
        }
      }

      await setValue(parsedValue)
      message.success('设置成功')
      setInputValue('')
    } catch (error) {
      message.error(`设置失败: ${(error as Error).message}`)
    }
  }

  const testCases = [
    { key: 'ui.theme_mode', label: 'App Theme Mode', sampleValue: 'ThemeMode.dark', type: 'enum' },
    { key: 'app.language', label: 'App Language', sampleValue: 'zh-CN', type: 'enum' },
    { key: 'app.spell_check.enabled', label: 'Spell Check', sampleValue: 'true', type: 'boolean' },
    { key: 'app.zoom_factor', label: 'Zoom Factor', sampleValue: '1.2', type: 'number', min: 0.5, max: 2.0, step: 0.1 },
    { key: 'app.tray.enabled', label: 'Tray Enabled', sampleValue: 'true', type: 'boolean' },
    {
      key: 'chat.message.font_size',
      label: 'Message Font Size',
      sampleValue: '14',
      type: 'number',
      min: 8,
      max: 72,
      step: 1
    },
    {
      key: 'feature.selection.action_window_opacity',
      label: 'Selection Window Opacity',
      sampleValue: '95',
      type: 'number',
      min: 10,
      max: 100,
      step: 5
    }
  ]

  return (
    <TestContainer $isDark={isDarkTheme}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {/* Key Selection */}
        <div>
          <Text strong>选择测试的偏好设置键:</Text>
          <Select
            value={selectedKey}
            onChange={setSelectedKey}
            style={{ width: '100%', marginTop: 4 }}
            placeholder="选择偏好设置键">
            {testCases.map((testCase) => (
              <Option key={testCase.key} value={testCase.key}>
                {testCase.label} ({testCase.key})
              </Option>
            ))}
          </Select>
        </div>

        {/* Current Value Display */}
        <CurrentValueContainer $isDark={isDarkTheme}>
          <Text strong>当前值:</Text>
          <ValueDisplay>
            {value !== undefined ? (
              typeof value === 'object' ? (
                JSON.stringify(value, null, 2)
              ) : (
                String(value)
              )
            ) : (
              <Text type="secondary">undefined (未设置或未加载)</Text>
            )}
          </ValueDisplay>
        </CurrentValueContainer>

        {/* Set New Value */}
        <div>
          <Text strong>设置新值:</Text>
          <Space.Compact style={{ width: '100%', marginTop: 4 }}>
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="输入新值 (JSON格式用于对象/数组)"
              onPressEnter={handleSetValue}
            />
            <Button type="primary" onClick={handleSetValue}>
              设置
            </Button>
          </Space.Compact>
        </div>

        {/* Quick Actions */}
        <div>
          <Text strong>快速操作:</Text>
          <Space wrap style={{ marginTop: 8 }}>
            {/* Theme Toggle with Visual Feedback */}
            {selectedKey === 'ui.theme_mode' && (
              <Button
                size="small"
                type={isDarkTheme ? 'default' : 'primary'}
                icon={isDarkTheme ? '🌙' : '☀️'}
                onClick={() => setValue(value === 'ThemeMode.dark' ? 'ThemeMode.light' : 'ThemeMode.dark')}>
                切换主题 ({value === 'ThemeMode.dark' ? '→ Light' : '→ Dark'})
              </Button>
            )}

            {/* Boolean Toggle */}
            {selectedKey === 'app.spell_check.enabled' && (
              <Switch isSelected={value === true} onValueChange={(checked) => setValue(checked)} />
            )}

            {/* Language Switch */}
            {selectedKey === 'app.language' && (
              <>
                <Button size="small" onClick={() => setValue('zh-CN')}>
                  中文
                </Button>
                <Button size="small" onClick={() => setValue('en-US')}>
                  English
                </Button>
              </>
            )}

            {/* Number Type Sliders */}
            {(() => {
              const currentTestCase = testCases.find((tc) => tc.key === selectedKey)
              if (currentTestCase?.type === 'number') {
                const numValue =
                  typeof value === 'number'
                    ? value
                    : typeof value === 'string'
                      ? parseFloat(value)
                      : currentTestCase.min || 0
                const min = currentTestCase.min || 0
                const max = currentTestCase.max || 100
                const step = currentTestCase.step || 1

                const getDisplayValue = () => {
                  if (selectedKey === 'app.zoom_factor') {
                    return `${Math.round(numValue * 100)}%`
                  } else if (selectedKey === 'feature.selection.action_window_opacity') {
                    return `${Math.round(numValue)}%`
                  } else {
                    return numValue.toString()
                  }
                }

                const getMarks = () => {
                  if (selectedKey === 'app.zoom_factor') {
                    return {
                      0.5: '50%',
                      0.8: '80%',
                      1.0: '100%',
                      1.2: '120%',
                      1.5: '150%',
                      2.0: '200%'
                    }
                  } else if (selectedKey === 'chat.message.font_size') {
                    return {
                      8: '8px',
                      12: '12px',
                      14: '14px',
                      16: '16px',
                      18: '18px',
                      24: '24px',
                      36: '36px',
                      72: '72px'
                    }
                  } else if (selectedKey === 'feature.selection.action_window_opacity') {
                    return {
                      10: '10%',
                      30: '30%',
                      50: '50%',
                      70: '70%',
                      90: '90%',
                      100: '100%'
                    }
                  }
                  return {}
                }

                return (
                  <div style={{ width: '100%', marginTop: 8 }}>
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Text>
                        {currentTestCase.label}: <strong>{getDisplayValue()}</strong>
                      </Text>
                      <Slider
                        min={min}
                        max={max}
                        step={step}
                        value={numValue}
                        onChange={(val) => setValue(val)}
                        marks={getMarks()}
                        tooltip={{
                          formatter: (val) => {
                            if (selectedKey === 'app.zoom_factor') {
                              return `${Math.round((val || 0) * 100)}%`
                            } else if (selectedKey === 'feature.selection.action_window_opacity') {
                              return `${Math.round(val || 0)}%`
                            }
                            return val?.toString() || '0'
                          }
                        }}
                        style={{ width: '100%', marginBottom: 8 }}
                      />
                      {selectedKey === 'app.zoom_factor' && (
                        <Space>
                          <Button size="small" onClick={() => setValue(0.8)}>
                            80%
                          </Button>
                          <Button size="small" onClick={() => setValue(1.0)}>
                            100%
                          </Button>
                          <Button size="small" onClick={() => setValue(1.2)}>
                            120%
                          </Button>
                        </Space>
                      )}
                      {selectedKey === 'chat.message.font_size' && (
                        <Space>
                          <Button size="small" onClick={() => setValue(12)}>
                            Small
                          </Button>
                          <Button size="small" onClick={() => setValue(14)}>
                            Normal
                          </Button>
                          <Button size="small" onClick={() => setValue(16)}>
                            Large
                          </Button>
                        </Space>
                      )}
                      {selectedKey === 'feature.selection.action_window_opacity' && (
                        <Space>
                          <Button size="small" onClick={() => setValue(50)}>
                            50%
                          </Button>
                          <Button size="small" onClick={() => setValue(80)}>
                            80%
                          </Button>
                          <Button size="small" onClick={() => setValue(100)}>
                            100%
                          </Button>
                        </Space>
                      )}
                    </Space>
                  </div>
                )
              }
              return null
            })()}

            {/* Sample Values */}
            <Button
              size="small"
              type="dashed"
              onClick={() => {
                const testCase = testCases.find((tc) => tc.key === selectedKey)
                if (testCase) {
                  setInputValue(testCase.sampleValue)
                }
              }}>
              示例值
            </Button>
          </Space>
        </div>

        {/* Hook Status Info */}
        <StatusContainer>
          <Text type="secondary" style={{ fontSize: '12px' }}>
            Hook状态: 当前监听 "{selectedKey}", 值类型: {typeof value}, 是否已定义: {value !== undefined ? '是' : '否'}
          </Text>
        </StatusContainer>
      </Space>
    </TestContainer>
  )
}

const TestContainer = styled.div<{ $isDark: boolean }>`
  padding: 16px;
  background: ${(props) => (props.$isDark ? '#262626' : '#fafafa')};
  border-radius: 8px;

  .ant-typography {
    color: ${(props) => (props.$isDark ? '#fff' : 'inherit')} !important;
  }

  .ant-select-selector {
    background-color: ${(props) => (props.$isDark ? '#1f1f1f' : '#fff')} !important;
    border-color: ${(props) => (props.$isDark ? '#434343' : '#d9d9d9')} !important;
    color: ${(props) => (props.$isDark ? '#fff' : '#000')} !important;
  }

  .ant-input {
    background-color: ${(props) => (props.$isDark ? '#1f1f1f' : '#fff')} !important;
    border-color: ${(props) => (props.$isDark ? '#434343' : '#d9d9d9')} !important;
    color: ${(props) => (props.$isDark ? '#fff' : '#000')} !important;
  }
`

const CurrentValueContainer = styled.div<{ $isDark?: boolean }>`
  padding: 12px;
  background: ${(props) => (props.$isDark ? '#1f1f1f' : '#f0f0f0')};
  border-radius: 6px;
  border-left: 4px solid var(--color-primary);
`

const ValueDisplay = styled.pre`
  margin: 8px 0 0 0;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #333;
  white-space: pre-wrap;
  word-break: break-all;
`

const StatusContainer = styled.div`
  padding: 8px;
  background: #e6f7ff;
  border-radius: 4px;
  border: 1px solid #91d5ff;
`

export default PreferenceBasicTests
