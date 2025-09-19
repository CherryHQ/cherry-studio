import { AppLogo } from '@renderer/config/env'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { loggerService } from '@renderer/services/LoggerService'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { Button, Card, Col, Divider, Layout, Row, Space, Tabs, Typography } from 'antd'
import { Activity, AlertTriangle, Database, FlaskConical, Settings, TestTube, TrendingUp, Zap } from 'lucide-react'
import React from 'react'
import styled from 'styled-components'

import CacheAdvancedTests from './components/CacheAdvancedTests'
import CacheBasicTests from './components/CacheBasicTests'
import CacheServiceTests from './components/CacheServiceTests'
import CacheStressTests from './components/CacheStressTests'
import DataApiAdvancedTests from './components/DataApiAdvancedTests'
import DataApiBasicTests from './components/DataApiBasicTests'
import DataApiHookTests from './components/DataApiHookTests'
import DataApiStressTests from './components/DataApiStressTests'
import PreferenceBasicTests from './components/PreferenceBasicTests'
import PreferenceHookTests from './components/PreferenceHookTests'
import PreferenceMultipleTests from './components/PreferenceMultipleTests'
import PreferenceServiceTests from './components/PreferenceServiceTests'

const { Header, Content } = Layout
const { Title, Text } = Typography

const logger = loggerService.withContext('TestApp')

const TestApp: React.FC = () => {
  // Get window number from multiple sources
  const getWindowNumber = () => {
    // Try URL search params first
    const urlParams = new URLSearchParams(window.location.search)
    const windowParam = urlParams.get('window')
    if (windowParam) {
      return windowParam
    }

    // Try document title
    const windowTitle = document.title
    const windowMatch = windowTitle.match(/#(\d+)/)
    if (windowMatch) {
      return windowMatch[1]
    }

    // Try window name
    if (window.name && window.name.includes('#')) {
      const nameMatch = window.name.match(/#(\d+)/)
      if (nameMatch) {
        return nameMatch[1]
      }
    }

    // Fallback: generate based on window creation time
    return Math.floor(Date.now() / 1000) % 100
  }

  const windowNumber = getWindowNumber()

  // Add theme preference monitoring for UI changes
  const [theme, setTheme] = usePreference('ui.theme_mode')
  const [language] = usePreference('app.language')
  const [zoomFactor] = usePreference('app.zoom_factor')

  // Apply theme-based styling
  const isDarkTheme = theme === ThemeMode.dark
  const headerBg = isDarkTheme ? '#141414' : '#fff'
  const borderColor = isDarkTheme ? '#303030' : '#f0f0f0'
  const textColor = isDarkTheme ? '#fff' : '#000'

  // Apply zoom factor
  const zoomValue = typeof zoomFactor === 'number' ? zoomFactor : 1.0

  return (
    <Layout style={{ height: '100vh', transform: `scale(${zoomValue})`, transformOrigin: 'top left' }}>
      <Header
        style={{ background: headerBg, borderBottom: `1px solid ${borderColor}`, padding: '0 24px', color: textColor }}>
        <HeaderContent>
          <Space align="center">
            <img src={AppLogo} alt="Logo" style={{ width: 28, height: 28, borderRadius: 6 }} />
            <Title level={4} style={{ margin: 0, color: textColor }}>
              Test Window #{windowNumber} {isDarkTheme ? '🌙' : '☀️'}
            </Title>
          </Space>
          <Space>
            <FlaskConical size={20} color={isDarkTheme ? '#fff' : 'var(--color-primary)'} />
            <Text style={{ color: textColor }}>
              Cross-Window Sync Testing | {language || 'en-US'} | Zoom: {Math.round(zoomValue * 100)}%
            </Text>
          </Space>
        </HeaderContent>
      </Header>

      <Content style={{ padding: '24px', overflow: 'auto', backgroundColor: isDarkTheme ? '#000' : '#f5f5f5' }}>
        <Container>
          <Row gutter={[24, 24]}>
            {/* Introduction Card */}
            <Col span={24}>
              <Card style={{ backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff', borderColor: borderColor }}>
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <Space align="center">
                    <TestTube size={24} color="var(--color-primary)" />
                    <Title level={3} style={{ margin: 0, color: textColor }}>
                      数据重构项目测试套件 (窗口 #{windowNumber})
                    </Title>
                  </Space>
                  <Text style={{ color: isDarkTheme ? '#d9d9d9' : 'rgba(0, 0, 0, 0.45)' }}>
                    此测试窗口用于验证数据重构项目的各项功能，包括 PreferenceService、CacheService、DataApiService
                    和相关 React hooks 的完整测试套件。
                  </Text>
                  <Text style={{ color: isDarkTheme ? '#d9d9d9' : 'rgba(0, 0, 0, 0.45)' }}>
                    PreferenceService 测试使用真实的偏好设置系统，CacheService 测试使用三层缓存架构，DataApiService
                    测试使用专用的测试路由和假数据。
                  </Text>
                  <Text style={{ color: 'var(--color-primary)', fontWeight: 'bold' }}>
                    📋 跨窗口测试指南：在一个窗口中修改偏好设置，观察其他窗口是否实时同步更新。
                  </Text>
                  <Text style={{ color: 'var(--color-secondary)', fontWeight: 'bold' }}>
                    🗄️ 缓存系统测试：三层缓存架构（Memory/Shared/Persist），支持跨窗口同步、TTL过期、性能优化。
                  </Text>
                  <Text style={{ color: 'var(--color-tertiary)', fontWeight: 'bold' }}>
                    🚀 数据API测试：包含基础CRUD、高级功能、React hooks和压力测试，全面验证数据请求架构。
                  </Text>
                </Space>
              </Card>
            </Col>

            {/* Main Content Tabs */}
            <Col span={24}>
              <StyledTabs
                defaultActiveKey="preference"
                size="large"
                $isDark={isDarkTheme}
                style={{
                  backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff',
                  borderRadius: 8,
                  padding: '0 16px',
                  border: `1px solid ${borderColor}`
                }}
                items={[
                  {
                    key: 'preference',
                    label: (
                      <Space>
                        <Settings size={16} />
                        <span>PreferenceService 测试</span>
                      </Space>
                    ),
                    children: (
                      <Row gutter={[24, 24]}>
                        {/* PreferenceService Basic Tests */}
                        <Col span={24}>
                          <Card
                            title={
                              <Space>
                                <Database size={18} color={isDarkTheme ? '#fff' : '#000'} />
                                <span style={{ color: textColor }}>PreferenceService 基础测试</span>
                              </Space>
                            }
                            size="small"
                            style={{ backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff', borderColor: borderColor }}>
                            <PreferenceServiceTests />
                          </Card>
                        </Col>

                        {/* Basic Hook Tests */}
                        <Col span={12}>
                          <Card
                            title={
                              <Space>
                                <Settings size={18} color={isDarkTheme ? '#fff' : '#000'} />
                                <span style={{ color: textColor }}>usePreference Hook 测试</span>
                              </Space>
                            }
                            size="small"
                            style={{ backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff', borderColor: borderColor }}>
                            <PreferenceBasicTests />
                          </Card>
                        </Col>

                        {/* Hook Tests */}
                        <Col span={12}>
                          <Card
                            title={
                              <Space>
                                <Settings size={18} color={isDarkTheme ? '#fff' : '#000'} />
                                <span style={{ color: textColor }}>Hook 高级功能测试</span>
                              </Space>
                            }
                            size="small"
                            style={{ backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff', borderColor: borderColor }}>
                            <PreferenceHookTests />
                          </Card>
                        </Col>

                        {/* Multiple Preferences Tests */}
                        <Col span={24}>
                          <Card
                            title={
                              <Space>
                                <Database size={18} color={isDarkTheme ? '#fff' : '#000'} />
                                <span style={{ color: textColor }}>usePreferences 批量操作测试</span>
                              </Space>
                            }
                            size="small"
                            style={{ backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff', borderColor: borderColor }}>
                            <PreferenceMultipleTests />
                          </Card>
                        </Col>
                      </Row>
                    )
                  },
                  {
                    key: 'cache',
                    label: (
                      <Space>
                        <Database size={16} />
                        <span>CacheService 测试</span>
                      </Space>
                    ),
                    children: (
                      <Row gutter={[24, 24]}>
                        {/* Cache Service Tests */}
                        <Col span={24}>
                          <Card
                            title={
                              <Space>
                                <Database size={18} color={isDarkTheme ? '#fff' : '#000'} />
                                <span style={{ color: textColor }}>CacheService 直接API测试</span>
                              </Space>
                            }
                            size="small"
                            style={{ backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff', borderColor: borderColor }}>
                            <CacheServiceTests />
                          </Card>
                        </Col>

                        {/* Cache Basic Tests */}
                        <Col span={24}>
                          <Card
                            title={
                              <Space>
                                <Settings size={18} color={isDarkTheme ? '#fff' : '#000'} />
                                <span style={{ color: textColor }}>Cache Hooks 基础测试</span>
                              </Space>
                            }
                            size="small"
                            style={{ backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff', borderColor: borderColor }}>
                            <CacheBasicTests />
                          </Card>
                        </Col>

                        {/* Cache Advanced Tests */}
                        <Col span={24}>
                          <Card
                            title={
                              <Space>
                                <Activity size={18} color={isDarkTheme ? '#fff' : '#000'} />
                                <span style={{ color: textColor }}>Cache 高级功能测试</span>
                              </Space>
                            }
                            size="small"
                            style={{ backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff', borderColor: borderColor }}>
                            <CacheAdvancedTests />
                          </Card>
                        </Col>

                        {/* Cache Stress Tests */}
                        <Col span={24}>
                          <Card
                            title={
                              <Space>
                                <AlertTriangle size={18} color={isDarkTheme ? '#fff' : '#000'} />
                                <span style={{ color: textColor }}>Cache 压力测试</span>
                              </Space>
                            }
                            size="small"
                            style={{ backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff', borderColor: borderColor }}>
                            <CacheStressTests />
                          </Card>
                        </Col>
                      </Row>
                    )
                  },
                  {
                    key: 'dataapi',
                    label: (
                      <Space>
                        <Zap size={16} />
                        <span>DataApiService 测试</span>
                      </Space>
                    ),
                    children: (
                      <Row gutter={[24, 24]}>
                        {/* DataApi Basic Tests */}
                        <Col span={24}>
                          <Card
                            title={
                              <Space>
                                <Database size={18} color={isDarkTheme ? '#fff' : '#000'} />
                                <span style={{ color: textColor }}>DataApi 基础功能测试 (CRUD操作)</span>
                              </Space>
                            }
                            size="small"
                            style={{ backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff', borderColor: borderColor }}>
                            <DataApiBasicTests />
                          </Card>
                        </Col>

                        {/* DataApi Advanced Tests */}
                        <Col span={24}>
                          <Card
                            title={
                              <Space>
                                <Activity size={18} color={isDarkTheme ? '#fff' : '#000'} />
                                <span style={{ color: textColor }}>DataApi 高级功能测试 (取消、重试、批量)</span>
                              </Space>
                            }
                            size="small"
                            style={{ backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff', borderColor: borderColor }}>
                            <DataApiAdvancedTests />
                          </Card>
                        </Col>

                        {/* DataApi Hook Tests */}
                        <Col span={24}>
                          <Card
                            title={
                              <Space>
                                <TrendingUp size={18} color={isDarkTheme ? '#fff' : '#000'} />
                                <span style={{ color: textColor }}>DataApi React Hooks 测试</span>
                              </Space>
                            }
                            size="small"
                            style={{ backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff', borderColor: borderColor }}>
                            <DataApiHookTests />
                          </Card>
                        </Col>

                        {/* DataApi Stress Tests */}
                        <Col span={24}>
                          <Card
                            title={
                              <Space>
                                <AlertTriangle size={18} color={isDarkTheme ? '#fff' : '#000'} />
                                <span style={{ color: textColor }}>DataApi 压力测试 (性能与错误处理)</span>
                              </Space>
                            }
                            size="small"
                            style={{ backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff', borderColor: borderColor }}>
                            <DataApiStressTests />
                          </Card>
                        </Col>
                      </Row>
                    )
                  }
                ]}
              />
            </Col>
          </Row>

          <Divider />

          <Row justify="center">
            <Space>
              <Button
                icon={isDarkTheme ? '☀️' : '🌙'}
                onClick={async () => {
                  await setTheme(isDarkTheme ? ThemeMode.light : ThemeMode.dark)
                }}
                style={{
                  backgroundColor: isDarkTheme ? '#434343' : '#f0f0f0',
                  borderColor: borderColor,
                  color: textColor
                }}>
                {isDarkTheme ? '切换到亮色主题' : '切换到暗色主题'}
              </Button>
              <Button
                type="primary"
                onClick={() => {
                  logger.info('Closing test window')
                  window.close()
                }}>
                关闭测试窗口
              </Button>
            </Space>
          </Row>
        </Container>
      </Content>
    </Layout>
  )
}

const HeaderContent = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 100%;
`

const Container = styled.div`
  max-width: 1200px;
  margin: 0 auto;
`

const StyledTabs = styled(Tabs)<{ $isDark: boolean }>`
  .ant-tabs-nav {
    background: ${(props) => (props.$isDark ? '#262626' : '#fafafa')};
    border-radius: 6px 6px 0 0;
    margin-bottom: 0;
  }

  .ant-tabs-tab {
    color: ${(props) => (props.$isDark ? '#d9d9d9' : '#666')} !important;

    &:hover {
      color: ${(props) => (props.$isDark ? '#fff' : '#000')} !important;
    }

    &.ant-tabs-tab-active {
      color: ${(props) => (props.$isDark ? '#1890ff' : '#1890ff')} !important;

      .ant-tabs-tab-btn {
        color: ${(props) => (props.$isDark ? '#1890ff' : '#1890ff')} !important;
      }
    }
  }

  .ant-tabs-ink-bar {
    background: ${(props) => (props.$isDark ? '#1890ff' : '#1890ff')};
  }

  .ant-tabs-content {
    background: ${(props) => (props.$isDark ? '#1f1f1f' : '#fff')};
    border-radius: 0 0 6px 6px;
    padding: 24px 0;
  }

  .ant-tabs-tabpane {
    color: ${(props) => (props.$isDark ? '#fff' : '#000')};
  }
`

export default TestApp
