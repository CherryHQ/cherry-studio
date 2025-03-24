import { app } from 'electron'
import { EventEmitter } from 'events'
import fetch from 'node-fetch'
import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'
import { configManager } from './ConfigManager'

/**
 * TTS（Text-to-Speech）服务
 * 处理文本转语音请求，支持OpenAI兼容的TTS API和Microsoft Edge TTS
 */
export default class TTSService extends EventEmitter {
  private isPlaying: boolean = false
  private ffmpegProcess: any = null
  private tempAudioPath: string = ''
  private ffplayAvailable: boolean = false
  
  // OpenAI TTS 默认声音
  private openaiVoices: string[] = [
    'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'
  ]
  
  // Edge TTS 声音列表
  private edgeTtsVoices: { name: string; locale: string; gender: string }[] = []
  
  // 可用的声音列表
  private availableVoices: string[] = []

  constructor() {
    super()
    // 确保临时目录存在
    this.tempAudioPath = path.join(app.getPath('temp'), 'cherry-studio-tts')
    if (!fs.existsSync(this.tempAudioPath)) {
      fs.mkdirSync(this.tempAudioPath, { recursive: true })
    }
    
    // 检测ffplay是否可用
    this.checkFfplayAvailability()
    
    // 初始化可用声音列表
    this.updateAvailableVoices()
    
    // 尝试获取 Edge TTS 声音列表
    this.fetchEdgeTtsVoices()
  }
  
  /**
   * 更新可用声音列表
   */
  private updateAvailableVoices(): void {
    const ttsType = configManager.get('ttsType') || 'openai'
    
    if (ttsType === 'edge') {
      // Edge TTS声音列表
      if (this.edgeTtsVoices.length > 0) {
        this.availableVoices = this.edgeTtsVoices.map(voice => voice.name)
      } else {
        // 默认提供一些常用的Edge TTS声音
        this.availableVoices = [
          'zh-CN-XiaoxiaoNeural',
          'zh-CN-YunxiNeural',
          'en-US-AriaNeural'
        ]
      }
    } else {
      // OpenAI TTS声音
      this.availableVoices = this.openaiVoices
    }
  }
  
  /**
   * 获取Edge TTS支持的声音列表
   */
  private async fetchEdgeTtsVoices(): Promise<void> {
    try {
      // 预定义的Edge TTS声音列表
      this.edgeTtsVoices = [
        { name: 'zh-CN-XiaoxiaoNeural', locale: 'zh-CN', gender: 'Female' },
        { name: 'zh-CN-YunxiNeural', locale: 'zh-CN', gender: 'Male' },
        { name: 'zh-CN-YunyangNeural', locale: 'zh-CN', gender: 'Male' },
        { name: 'en-US-AriaNeural', locale: 'en-US', gender: 'Female' },
        { name: 'en-US-GuyNeural', locale: 'en-US', gender: 'Male' }
      ]
      
      this.updateAvailableVoices()
    } catch (error) {
      console.error('Edge TTS声音列表设置失败:', error)
    }
  }
  
  /**
   * 检测ffplay命令是否可用
   */
  private checkFfplayAvailability(): void {
    try {
      const { execSync } = require('child_process')
      execSync('ffplay -version', { stdio: 'ignore' })
      this.ffplayAvailable = true
    } catch (error) {
      this.ffplayAvailable = false
    }
  }

  /**
   * 播放指定文本
   */
  async speak(text: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 停止当前播放
      this.stop()

      // 检查TTS是否启用
      const ttsEnabled = configManager.get('ttsEnabled') || false
      if (!ttsEnabled) {
        return { success: false, error: 'TTS功能未启用' }
      }
      
      // 获取TTS类型和播放器类型
      const ttsType = configManager.get('ttsType') as string || 'openai'
      const playerType = configManager.get('ttsPlayerType') as string || 'auto'
      
      // 根据TTS类型选择处理方式
      if (ttsType === 'edge') {
        return await this.speakWithEdgeTTS(text, playerType)
      } else {
        return await this.speakWithOpenAI(text, playerType)
      }
    } catch (error: any) {
      return { 
        success: false, 
        error: `TTS生成失败: ${error.message}`
      }
    }
  }
  
  /**
   * 使用OpenAI TTS API播放文本
   */
  private async speakWithOpenAI(text: string, playerType: string): Promise<{ success: boolean; error?: string }> {
    try {
      const apiUrl = configManager.get('ttsApiUrl') as string || ''
      const apiKey = configManager.get('ttsApiKey') as string || ''
      const model = configManager.get('ttsModel') as string || 'tts-1'
      const voice = configManager.get('ttsVoice') as string || 'alloy'

      if (!apiUrl || !apiKey) {
        return { success: false, error: '未配置API网址或密钥' }
      }

      // API请求
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model, voice, input: text })
      })

      if (!response.ok) {
        const errorData = await response.json()
        return { 
          success: false, 
          error: `API错误: ${errorData.error?.message || response.statusText}`
        }
      }

      // 获取音频数据并保存
      const audioData = await response.arrayBuffer()
      const fileName = `tts-${Date.now()}.mp3`
      const filePath = path.join(this.tempAudioPath, fileName)
      fs.writeFileSync(filePath, Buffer.from(audioData))
      
      // 播放音频文件
      return await this.playAudioFile(filePath, playerType)
    } catch (error: any) {
      return { 
        success: false, 
        error: `OpenAI TTS生成失败: ${error.message}`
      }
    }
  }
  
  /**
   * 使用Edge TTS播放文本
   */
  private async speakWithEdgeTTS(text: string, playerType: string): Promise<{ success: boolean; error?: string }> {
    try {
      const voice = configManager.get('ttsVoice') as string || 'zh-CN-XiaoxiaoNeural'
      const rate = configManager.get('ttsEdgeRate') as string || '+0%'
      const volume = configManager.get('ttsEdgeVolume') as string || '+0%'
      
      // 临时文件路径
      const fileName = `tts-edge-${Date.now()}.mp3`
      const filePath = path.join(this.tempAudioPath, fileName)

      try {
        // 尝试连接本地EdgeTTS API服务
        const edgeTtsApiUrl = 'http://localhost:7899/v1/audio/speech'
        const rate_num = rate.replace('%', '')
        const volume_num = volume.replace('%', '')
        
        // 计算速度和音量
        const speed_value = 1.0 + (parseInt(rate_num) / 100)
        const volume_value = 1.0 + (parseInt(volume_num) / 100)
        
        // 调用本地EdgeTTS API
        const response = await fetch(edgeTtsApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            input: text,
            voice: voice,
            speed: speed_value,
            volume: volume_value,
            pitch: 1.0
          })
        })
        
        if (!response.ok) {
          throw new Error(`Edge TTS API响应错误: ${response.status}`)
        }

        // 获取并保存音频数据
        const audioData = await response.arrayBuffer()
        fs.writeFileSync(filePath, Buffer.from(audioData))
        
        // 播放音频文件
        return await this.playAudioFile(filePath, playerType)
      } catch (edgeApiError: any) {
        // 尝试使用OpenAI TTS作为备选
        return { 
          success: false, 
          error: `Edge TTS服务请求失败: ${edgeApiError.message}`
        }
      }
    } catch (error: any) {
      return { 
        success: false, 
        error: `Edge TTS生成失败: ${error.message}`
      }
    }
  }
  
  /**
   * 播放音频文件
   */
  private async playAudioFile(filePath: string, playerType: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 根据播放器类型选择播放方式
      if (playerType === 'system') {
        await this.playWithSystemDefault(filePath)
      } else if (playerType === 'ffmpeg' && this.ffplayAvailable) {
        await this.playWithFfplay(filePath)
      } else if (playerType === 'auto') {
        // 自动选择：优先使用ffplay
        if (this.ffplayAvailable) {
          await this.playWithFfplay(filePath)
        } else {
          await this.playWithSystemDefault(filePath)
        }
      } else {
        await this.playWithSystemDefault(filePath)
      }
      
      return { success: true }
    } catch (error: any) {
      return { 
        success: false, 
        error: `播放音频文件失败: ${error.message}`
      }
    }
  }

  /**
   * 使用ffplay播放音频
   */
  private async playWithFfplay(filePath: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        this.ffmpegProcess = spawn('ffplay', [
          '-nodisp',
          '-autoexit',
          '-loglevel', 'quiet',
          filePath
        ])
        
        this.isPlaying = true
        
        // 监听进程结束事件
        this.ffmpegProcess.on('close', () => {
          this.isPlaying = false
          this.ffmpegProcess = null
        })
        
        // 监听错误
        this.ffmpegProcess.on('error', () => {
          this.isPlaying = false
          this.ffmpegProcess = null
          resolve(false)
        })
        
        resolve(true)
      } catch (error: any) {
        resolve(false)
      }
    })
  }

  /**
   * 使用系统默认播放器播放音频
   */
  private async playWithSystemDefault(filePath: string): Promise<boolean> {
    try {
      const { shell } = require('electron')
      await shell.openPath(filePath)
      this.isPlaying = true
      return true
    } catch (error: any) {
      return false
    }
  }

  /**
   * 停止当前播放
   */
  stop(): void {
    if (this.isPlaying && this.ffmpegProcess) {
      try {
        // 在Windows上使用taskkill强制终止进程
        if (process.platform === 'win32') {
          const { execSync } = require('child_process')
          execSync(`taskkill /pid ${this.ffmpegProcess.pid} /f /t`)
        } else {
          // 在Unix系统上使用kill信号
          this.ffmpegProcess.kill('SIGTERM')
        }
      } catch (error: any) {
        console.error('停止ffplay进程失败:', error)
      }
      
      this.ffmpegProcess = null
      this.isPlaying = false
    }
    
    // 清理临时文件
    this.cleanupTempFiles()
  }

  /**
   * 获取可用的声音列表
   */
  getVoices(): string[] {
    return this.availableVoices
  }
  
  /**
   * 获取API选项
   */
  async fetchAvailableOptions(): Promise<{ 
    success: boolean; 
    models?: string[]; 
    voices?: string[];
    error?: string;
  }> {
    try {
      const ttsType = configManager.get('ttsType') || 'openai'
      
      if (ttsType === 'edge') {
        // Edge TTS选项
        const voices = this.edgeTtsVoices.map(voice => voice.name)
        return {
          success: true,
          models: ['edge-tts'],
          voices: voices
        }
      } else {
        // OpenAI TTS选项
        return {
          success: true,
          models: ['tts-1', 'tts-1-hd'],
          voices: this.openaiVoices
        }
      }
    } catch (error: any) {
      return {
        success: false,
        error: `获取选项失败: ${error.message}`
      }
    }
  }

  /**
   * 检查TTS服务是否可用
   */
  isAvailable(): boolean {
    const ttsEnabled = configManager.get('ttsEnabled') || false
    const ttsType = configManager.get('ttsType') || 'openai'
    
    if (!ttsEnabled) {
      return false
    }
    
    if (ttsType === 'edge') {
      // Edge TTS不需要额外配置
      return true
    } else {
      // OpenAI TTS需要API配置
      const apiUrl = configManager.get('ttsApiUrl') as string || ''
      const apiKey = configManager.get('ttsApiKey') as string || ''
      return !!apiUrl && !!apiKey
    }
  }

  /**
   * 清理临时文件
   */
  private cleanupTempFiles(): void {
    try {
      if (fs.existsSync(this.tempAudioPath)) {
        const files = fs.readdirSync(this.tempAudioPath)
        
        // 删除1小时前的文件
        const oneHourAgo = Date.now() - 3600000
        
        for (const file of files) {
          const filePath = path.join(this.tempAudioPath, file)
          const stats = fs.statSync(filePath)
          
          if (stats.ctimeMs < oneHourAgo) {
            fs.unlinkSync(filePath)
          }
        }
      }
    } catch (error: any) {
      console.error('清理临时文件失败:', error)
    }
  }
}