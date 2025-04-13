import { InfoCircleOutlined } from '@ant-design/icons'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  setDecayEnabled,
  setDecayRate,
  setFreshnessEnabled,
  setPriorityManagementEnabled,
  updateMemoryPriorities
} from '@renderer/store/memory'
import { Button, InputNumber, Slider, Switch, Tooltip } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const SliderContainer = styled.div`
  display: flex;
  align-items: center;
  width: 100%;
  max-width: 300px;
  margin-right: 16px;
`

const PriorityManagementSettings: FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  
  // 获取相关状态
  const priorityManagementEnabled = useAppSelector((state) => state.memory.priorityManagementEnabled)
  const decayEnabled = useAppSelector((state) => state.memory.decayEnabled)
  const freshnessEnabled = useAppSelector((state) => state.memory.freshnessEnabled)
  const decayRate = useAppSelector((state) => state.memory.decayRate)
  
  // 处理开关状态变化
  const handlePriorityManagementToggle = (checked: boolean) => {
    dispatch(setPriorityManagementEnabled(checked))
  }
  
  const handleDecayToggle = (checked: boolean) => {
    dispatch(setDecayEnabled(checked))
  }
  
  const handleFreshnessToggle = (checked: boolean) => {
    dispatch(setFreshnessEnabled(checked))
  }
  
  // 处理衰减率变化
  const handleDecayRateChange = (value: number | null) => {
    if (value !== null) {
      dispatch(setDecayRate(value))
    }
  }
  
  // 手动更新记忆优先级
  const handleUpdatePriorities = () => {
    dispatch(updateMemoryPriorities())
  }
  
  return (
    <SettingGroup>
      <SettingTitle>{t('settings.memory.priorityManagement.title') || '智能优先级与时效性管理'}</SettingTitle>
      <SettingHelpText>
        {t('settings.memory.priorityManagement.description') || 
          '智能管理记忆的优先级、衰减和鲜度，确保最重要和最相关的记忆优先显示。'}
      </SettingHelpText>
      
      <SettingRow>
        <SettingRowTitle>
          {t('settings.memory.priorityManagement.enable') || '启用智能优先级管理'}
          <Tooltip title={t('settings.memory.priorityManagement.enableTip') || 
            '启用后，系统将根据重要性、访问频率和时间因素自动排序记忆'}>
            <InfoCircleOutlined style={{ marginLeft: 8 }} />
          </Tooltip>
        </SettingRowTitle>
        <Switch checked={priorityManagementEnabled} onChange={handlePriorityManagementToggle} />
      </SettingRow>
      
      <SettingDivider />
      
      <SettingRow>
        <SettingRowTitle>
          {t('settings.memory.priorityManagement.decay') || '记忆衰减'}
          <Tooltip title={t('settings.memory.priorityManagement.decayTip') || 
            '随着时间推移，未访问的记忆重要性会逐渐降低'}>
            <InfoCircleOutlined style={{ marginLeft: 8 }} />
          </Tooltip>
        </SettingRowTitle>
        <Switch 
          checked={decayEnabled} 
          onChange={handleDecayToggle} 
          disabled={!priorityManagementEnabled} 
        />
      </SettingRow>
      
      <SettingRow>
        <SettingRowTitle>
          {t('settings.memory.priorityManagement.decayRate') || '衰减速率'}
          <Tooltip title={t('settings.memory.priorityManagement.decayRateTip') || 
            '值越大，记忆衰减越快。0.05表示每天衰减5%'}>
            <InfoCircleOutlined style={{ marginLeft: 8 }} />
          </Tooltip>
        </SettingRowTitle>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <SliderContainer>
            <Slider
              min={0.01}
              max={0.2}
              step={0.01}
              value={decayRate}
              onChange={handleDecayRateChange}
              disabled={!priorityManagementEnabled || !decayEnabled}
              style={{ flex: 1 }}
            />
          </SliderContainer>
          <InputNumber
            min={0.01}
            max={0.2}
            step={0.01}
            value={decayRate}
            onChange={handleDecayRateChange}
            disabled={!priorityManagementEnabled || !decayEnabled}
            style={{ width: 70 }}
          />
        </div>
      </SettingRow>
      
      <SettingRow>
        <SettingRowTitle>
          {t('settings.memory.priorityManagement.freshness') || '记忆鲜度'}
          <Tooltip title={t('settings.memory.priorityManagement.freshnessTip') || 
            '考虑记忆的创建时间和最后访问时间，优先显示较新的记忆'}>
            <InfoCircleOutlined style={{ marginLeft: 8 }} />
          </Tooltip>
        </SettingRowTitle>
        <Switch 
          checked={freshnessEnabled} 
          onChange={handleFreshnessToggle} 
          disabled={!priorityManagementEnabled} 
        />
      </SettingRow>
      
      <SettingRow>
        <SettingRowTitle>
          {t('settings.memory.priorityManagement.updateNow') || '立即更新优先级'}
          <Tooltip title={t('settings.memory.priorityManagement.updateNowTip') || 
            '手动更新所有记忆的优先级和鲜度评分'}>
            <InfoCircleOutlined style={{ marginLeft: 8 }} />
          </Tooltip>
        </SettingRowTitle>
        <Button 
          onClick={handleUpdatePriorities} 
          disabled={!priorityManagementEnabled}
        >
          {t('settings.memory.priorityManagement.update') || '更新'}
        </Button>
      </SettingRow>
    </SettingGroup>
  )
}

export default PriorityManagementSettings
