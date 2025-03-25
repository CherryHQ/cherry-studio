import { app } from 'electron'
import { EventEmitter } from 'events'
import fetch from 'node-fetch'
import * as fs from 'fs'
import * as path from 'path'
import { configManager } from './ConfigManager'

/**
 * TTS（Text-to-Speech）服务
 * 处理文本转语音请求，支持OpenAI兼容的TTS API和Microsoft Edge TTS
 */
export default class TTSService extends EventEmitter {
  private isPlaying: boolean = false
  private ffmpegProcess: any = null; // 存储ffmpeg进程引用
  private tempAudioPath: string = '';
  private ffplayAvailable: boolean = false; // 是否有ffplay可用
  // OpenAI TTS 默认声音
  private openaiVoices: string[] = [
    'alloy',
    'echo',
    'fable',
    'onyx',
    'nova',
    'shimmer'
  ]
  
  // Edge TTS 声音列表 (将在运行时从API获取完整列表)
  private edgeTtsVoices: { name: string; locale: string; gender: string }[] = []
  
  // 获取当前可用的声音列表
  private availableVoices: string[] = []

  constructor() {
    super()
    // 确保临时目录存在
    this.tempAudioPath = path.join(app.getPath('temp'), 'cherry-studio-tts')
    if (!fs.existsSync(this.tempAudioPath)) {
      fs.mkdirSync(this.tempAudioPath, { recursive: true })
    }
    
    // 检测ffplay是否可用
    this.checkFfplayAvailability();
    
    // 初始化可用声音列表
    this.updateAvailableVoices();
    
    // 尝试获取 Edge TTS 声音列表
    this.fetchEdgeTtsVoices();
  }
  
  /**
   * 更新可用声音列表
   */
  private updateAvailableVoices(): void {
    const ttsType = configManager.get('ttsType') || 'openai';
    
    if (ttsType === 'edge') {
      // 如果已经获取到了Edge TTS声音列表
      if (this.edgeTtsVoices.length > 0) {
        this.availableVoices = this.edgeTtsVoices.map(voice => voice.name);
      } else {
        // 默认提供一些常用的Edge TTS声音作为备选
        this.availableVoices = [
          'zh-CN-XiaoxiaoNeural',
          'zh-CN-YunxiNeural',
          'zh-CN-YunyangNeural',
          'en-US-AriaNeural',
          'en-US-GuyNeural'
        ];
      }
    } else {
      // 默认使用OpenAI TTS声音
      this.availableVoices = this.openaiVoices;
    }
  }
  
  /**
   * 获取Edge TTS支持的声音列表
   */
  private async fetchEdgeTtsVoices(): Promise<void> {
    try {
      // 由于无法直接调用npx，使用预定义的Edge TTS声音列表
      this.edgeTtsVoices = [
        { name: 'zh-CN-XiaoxiaoNeural', locale: 'zh-CN', gender: 'Female' },
        { name: 'zh-CN-XiaoyiNeural', locale: 'zh-CN', gender: 'Female' },
        { name: 'zh-CN-YunjianNeural', locale: 'zh-CN', gender: 'Male' },
        { name: 'zh-CN-YunxiNeural', locale: 'zh-CN', gender: 'Male' },
        { name: 'zh-CN-YunyangNeural', locale: 'zh-CN', gender: 'Male' },
        { name: 'zh-CN-liaoning-XiaobeiNeural', locale: 'zh-CN-liaoning', gender: 'Female' },
        { name: 'zh-CN-shaanxi-XiaoniNeural', locale: 'zh-CN-shaanxi', gender: 'Female' },
        { name: 'zh-HK-HiuGaaiNeural', locale: 'zh-HK', gender: 'Female' },
        { name: 'zh-HK-HiuMaanNeural', locale: 'zh-HK', gender: 'Female' },
        { name: 'zh-HK-WanLungNeural', locale: 'zh-HK', gender: 'Male' },
        { name: 'zh-TW-HsiaoChenNeural', locale: 'zh-TW', gender: 'Female' },
        { name: 'zh-TW-YunJheNeural', locale: 'zh-TW', gender: 'Male' },
        { name: 'en-US-AnaNeural', locale: 'en-US', gender: 'Female' },
        { name: 'en-US-AriaNeural', locale: 'en-US', gender: 'Female' },
        { name: 'en-US-ChristopherNeural', locale: 'en-US', gender: 'Male' },
        { name: 'en-US-EricNeural', locale: 'en-US', gender: 'Male' },
        { name: 'en-US-GuyNeural', locale: 'en-US', gender: 'Male' },
        { name: 'en-US-JennyNeural', locale: 'en-US', gender: 'Female' },
        { name: 'en-US-MichelleNeural', locale: 'en-US', gender: 'Female' },
        { name: 'en-US-RogerNeural', locale: 'en-US', gender: 'Male' },
        { name: 'en-US-SteffanNeural', locale: 'en-US', gender: 'Male' }
      ];
      
      console.log(`预设了${this.edgeTtsVoices.length}个Edge TTS声音`);
      
      // 更新可用声音列表
      this.updateAvailableVoices();
    } catch (error) {
      console.error('设置Edge TTS声音列表失败:', error);
    }
  }
  
  /**
   * 检测ffplay命令是否可用
   */
  private checkFfplayAvailability(): void {
    try {
      const { execSync } = require('child_process');
      // 尝试执行ffplay -version命令
      execSync('ffplay -version', { stdio: 'ignore' });
      this.ffplayAvailable = true;
      console.log('ffplay可用，将使用ffplay播放音频');
    } catch (error) {
      this.ffplayAvailable = false;
      console.log('ffplay不可用，将使用系统默认播放器');
    }
  }

  /**
   * 播放指定文本
   */
  async speak(text: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 首先停止当前可能正在播放的任何内容
      this.stop()

      // 获取设置
      const ttsEnabled = configManager.get('ttsEnabled') || false
      if (!ttsEnabled) {
        return { success: false, error: 'TTS功能未启用' }
      }
      
      // 获取TTS类型
      const ttsType: string = configManager.get('ttsType') as string || 'openai'
      const playerType: string = configManager.get('ttsPlayerType') as string || 'auto'
      
      // 根据TTS类型选择不同的处理方式
      if (ttsType === 'edge') {
        return await this.speakWithEdgeTTS(text, playerType);
      } else {
        // 默认使用OpenAI TTS
        return await this.speakWithOpenAI(text, playerType);
      }
    } catch (error: any) {
      console.error('TTS生成失败:', error)
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
      const apiUrl: string = configManager.get('ttsApiUrl') as string || ''
      const apiKey: string = configManager.get('ttsApiKey') as string || ''
      const model: string = configManager.get('ttsModel') as string || 'tts-1'
      const voice: string = configManager.get('ttsVoice') as string || 'alloy'

      if (!apiUrl || !apiKey) {
        return { success: false, error: '未配置API网址或密钥' }
      }

      // 构造API请求
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          voice,
          input: text
        })
      })

      if (!response.ok) {
        const errorData = await response.json();
        return { 
          success: false, 
          error: `API错误: ${errorData.error?.message || response.statusText}`
        }
      }

      // 获取音频数据
      const audioData = await response.arrayBuffer()
      
      // 保存到临时文件
      const fileName = `tts-${Date.now()}.mp3`
      const filePath = path.join(this.tempAudioPath, fileName)
      fs.writeFileSync(filePath, Buffer.from(audioData))
      
      console.log('OpenAI TTS音频文件已保存到:', filePath);
      
      // 播放音频文件
      return await this.playAudioFile(filePath, playerType);
    } catch (error: any) {
      console.error('OpenAI TTS生成失败:', error);
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
      const voice: string = configManager.get('ttsVoice') as string || 'zh-CN-XiaoxiaoNeural'
      const rate: string = configManager.get('ttsEdgeRate') as string || '+0%'
      const volume: string = configManager.get('ttsEdgeVolume') as string || '+0%'
      
      // 创建临时文件路径
      const fileName = `tts-edge-${Date.now()}.mp3`
      const filePath = path.join(this.tempAudioPath, fileName)
      
      console.log(`使用Edge TTS生成语音，声音: ${voice}, 语速: ${rate}, 音量: ${volume}`);

      try {
        // 尝试连接本地EdgeTTS API服务（运行在端口7899上）
        console.log('尝试连接本地EdgeTTS API服务...');
        
        // 构造请求主体
        const edgeTtsApiUrl = 'http://localhost:7899/v1/audio/speech';
        const rate_num = rate.replace('%', '');
        const volume_num = volume.replace('%', '');
        
        // 计算速度和音量的数值（API要求1.0为基准）
        const speed_value = 1.0 + (parseInt(rate_num) / 100);
        const volume_value = 1.0 + (parseInt(volume_num) / 100);
        
        // 使用本地EdgeTTS API
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
            pitch: 1.0  // 默认不调整音调
          })
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData?.error?.message || `状态码: ${response.status}`);
        }

        // 获取音频数据
        const audioData = await response.arrayBuffer();
        
        // 保存到临时文件
        fs.writeFileSync(filePath, Buffer.from(audioData));
        
        console.log('本地EdgeTTS服务请求成功，音频文件已保存到:', filePath);
        
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
          // 播放生成的音频文件
          const playResult = await this.playAudioFile(filePath, playerType);
          return playResult;
        } else {
          return { 
            success: false, 
            error: '生成的音频文件无效或为空'
          };
        }
      } catch (edgeApiError: any) {
        console.error('本地EdgeTTS服务请求失败:', edgeApiError);
        console.log('尝试使用OpenAI TTS作为备选...');
        
        // 尝试使用OpenAI TTS作为备选
        try {
          // 获取OpenAI TTS设置
          const model: string = configManager.get('ttsModel') as string || 'tts-1';
          const apiUrl: string = configManager.get('ttsApiUrl') as string || '';
          const apiKey: string = configManager.get('ttsApiKey') as string || '';
          
          // 检查OpenAI TTS设置是否有效
          if (!apiUrl || !apiKey) {
            return { 
              success: false, 
              error: '本地EdgeTTS服务未启动或不可用，错误信息: ' + edgeApiError.message + '\n\n要使用EdgeTTS，请启动本地EdgeTTS服务(端口7899)，或者配置OpenAI TTS作为备选。' 
            };
          }
          
          // 使用OpenAI TTS API生成语音
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model,
              voice: 'alloy', // 使用默认音色
              input: text
            })
          });
          
          if (!response.ok) {
            throw new Error(`OpenAI TTS API返回错误: ${response.status}`);
          }

          // 获取音频数据
          const audioData = await response.arrayBuffer();
          
          // 保存到临时文件
          fs.writeFileSync(filePath, Buffer.from(audioData));
          
          console.log('OpenAI TTS API请求成功，音频文件已保存到:', filePath);
          
          if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
            // 播放生成的音频文件
            const playResult = await this.playAudioFile(filePath, playerType);
            return playResult;
          } else {
            return { 
              success: false, 
              error: '生成的音频文件无效或为空'
            };
          }
        } catch (openaiError: any) {
          console.error('OpenAI TTS API请求也失败:', openaiError);
          return { 
            success: false, 
            error: `无法使用Edge TTS(${edgeApiError.message})，OpenAI TTS也失败(${openaiError.message})。请确保已启动本地EdgeTTS服务或配置了有效的OpenAI TTS密钥。`
          };
        }
      }
    } catch (error: any) {
      console.error('Edge TTS生成失败:', error);
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
      // 首先停止任何正在播放的音频
      this.stop();
      
      // 根据播放器类型设置选择播放方式
      if (playerType === 'system') {
        // 使用系统默认播放器
        await this.playWithSystemDefault(filePath);
      } else if (playerType === 'ffmpeg' && this.ffplayAvailable) {
        // 强制使用ffplay
        await this.playWithFfplay(filePath);
      } else if (playerType === 'auto') {
        // 自动选择：优先使用ffplay，如果不可用则使用系统默认播放器
        if (this.ffplayAvailable) {
          await this.playWithFfplay(filePath);
        } else {
          await this.playWithSystemDefault(filePath);
        }
      } else {
        // 默认情况下使用系统播放器
        await this.playWithSystemDefault(filePath);
      }
      
      return { success: true };
    } catch (error: any) {
      console.error('播放音频文件失败:', error);
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
        const { spawn } = require('child_process');
        console.log('使用ffplay播放音频文件:', filePath);
        
        this.ffmpegProcess = spawn('ffplay', [
          '-nodisp',           // 不显示视频窗口
          '-autoexit',         // 播放完成后自动退出
          '-loglevel', 'quiet', // 静默输出
          filePath             // 音频文件路径
        ]);
        
        this.isPlaying = true;
        
        // 监听ffmpeg进程结束事件
        this.ffmpegProcess.on('close', (code) => {
          console.log(`ffplay进程结束，退出码: ${code}`);
          this.isPlaying = false;
          this.ffmpegProcess = null;
        });
        
        // 监听错误
        this.ffmpegProcess.on('error', (err) => {
          console.error('ffplay播放错误:', err);
          this.isPlaying = false;
          this.ffmpegProcess = null;
          resolve(false);
        });
        
        resolve(true);
      } catch (error: any) {
        console.error('启动ffplay播放失败:', error);
        resolve(false);
      }
    });
  }

  /**
   * 使用系统默认播放器播放音频
   */
  private async playWithSystemDefault(filePath: string): Promise<boolean> {
    try {
      const { shell } = require('electron');
      await shell.openPath(filePath);
      console.log('已使用系统默认播放器打开音频文件');
      this.isPlaying = true;
      return true;
    } catch (error: any) {
      console.error('使用系统默认播放器打开文件失败:', error);
      return false;
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
          const { execSync } = require('child_process');
          execSync(`taskkill /pid ${this.ffmpegProcess.pid} /f /t`);
        } else {
          // 在Unix系统上使用kill信号
          this.ffmpegProcess.kill('SIGTERM');
        }
        console.log('已停止ffplay播放进程');
      } catch (error: any) {
        console.error('停止ffplay进程失败:', error);
      }
      
      this.ffmpegProcess = null;
      this.isPlaying = false;
      this.emit('stop-audio');
    }
    
    // 清理临时文件夹中可能的旧文件
    this.cleanupTempFiles();
  }

  /**
   * 获取可用的声音列表
   */
  getVoices(): string[] {
    return this.availableVoices;
  }
  
  /**
   * 获取Edge TTS声音列表
   */
  getEdgeTtsVoices(): { name: string; locale: string; gender: string }[] {
    return this.edgeTtsVoices;
  }
  
  /**
   * 从API获取可用的模型和音色
   * 根据当前的TTS类型返回不同的选项
   */
  async fetchAvailableOptions(): Promise<{ 
    success: boolean; 
    models?: string[]; 
    voices?: string[];
    error?: string;
  }> {
    try {
      // 获取TTS类型
      const ttsType = configManager.get('ttsType') || 'openai';
      
      // 根据TTS类型选择不同的处理方式
      if (ttsType === 'edge') {
        return await this.fetchEdgeTtsOptions();
      } else {
        // 默认使用OpenAI TTS
        return await this.fetchOpenAIOptions();
      }
    } catch (error: any) {
      console.error('获取可用选项失败:', error);
      return {
        success: false,
        error: `获取可用选项失败: ${error.message}`
      };
    }
  }
  
  /**
   * 获取Edge TTS的选项
   */
  private async fetchEdgeTtsOptions(): Promise<{ 
    success: boolean; 
    models?: string[]; 
    voices?: string[];
    error?: string;
  }> {
    try {
      // 刷新Edge TTS的声音列表
      await this.fetchEdgeTtsVoices();
      
      if (this.edgeTtsVoices.length === 0) {
        return {
          success: false,
          error: '无法获取Edge TTS声音列表'
        };
      }
      
      // 提取声音名称列表
      const voices = this.edgeTtsVoices.map(voice => voice.name);
      
      // Edge TTS没有模型的概念，我们提供一个固定的"模型"列表
      const models = ['edge-tts'];
      
      return {
        success: true,
        models,
        voices
      };
    } catch (error: any) {
      console.error('获取Edge TTS选项失败:', error);
      return {
        success: false,
        error: `获取Edge TTS选项失败: ${error.message}`
      };
    }
  }
  
  /**
   * 获取OpenAI TTS的选项
   */
  private async fetchOpenAIOptions(): Promise<{ 
    success: boolean; 
    models?: string[]; 
    voices?: string[];
    error?: string;
  }> {
    try {
      // 获取设置
      const apiUrl: string = configManager.get('ttsApiUrl') as string || ''
      const apiKey: string = configManager.get('ttsApiKey') as string || ''
      
      if (!apiUrl || !apiKey) {
        return { success: false, error: '未配置API网址或密钥' }
      }
      
      // 构造URL（从语音API URL中提取基础URL）
      const baseUrl = apiUrl.replace(/\/v1\/audio\/speech$|\/audio\/speech$/, '');
      const modelsUrl = `${baseUrl}/v1/models`;
      const voicesUrl = `${baseUrl}/v1/audio/voices`;
      
      let ttsModels: string[] = [];
      let voices: string[] = [];
      
      // 获取可用模型
      try {
        console.log('正在获取可用模型列表:', modelsUrl);
        const modelsResponse = await fetch(modelsUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`
          }
        });
        
        if (modelsResponse.ok) {
          const modelsData = await modelsResponse.json();
          // 筛选出TTS模型（通常名称包含tts）
          ttsModels = modelsData.data
            ? modelsData.data
                .filter(model => typeof model.id === 'string' && (
                  model.id.includes('tts') || 
                  model.id.toLowerCase().includes('text-to-speech') ||
                  model.id.toLowerCase().includes('speech')
                ))
                .map(model => model.id)
            : [];
          
          console.log('获取到TTS模型:', ttsModels);
        } else {
          console.warn('获取模型列表失败:', await modelsResponse.text());
        }
      } catch (err: any) {
        console.warn('获取模型列表出错:', err.message);
      }
      
      // 尝试获取可用音色
      try {
        console.log('正在获取可用音色列表:', voicesUrl);
        const voicesResponse = await fetch(voicesUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`
          }
        });
        
        if (voicesResponse.ok) {
          const voicesData = await voicesResponse.json();
          
          // 通常voices API会返回一个voices数组
          if (voicesData.voices && Array.isArray(voicesData.voices)) {
            voices = voicesData.voices;
            console.log(`获取到${voices.length}个音色`);
          }
        } else {
          console.warn('获取音色列表失败:', await voicesResponse.text());
        }
      } catch (err: any) {
        console.warn('获取音色列表出错:', err.message);
      }
      
      // 如果没有获取到模型和音色，尝试使用默认值
      if (ttsModels.length === 0) {
        ttsModels = ['tts-1', 'tts-1-hd'];
      }
      
      if (voices.length === 0) {
        voices = this.openaiVoices;
      }
      
      return {
        success: true,
        models: ttsModels,
        voices: voices
      };
    } catch (error: any) {
      console.error('获取OpenAI TTS选项失败:', error);
      return {
        success: false,
        error: `获取OpenAI TTS选项失败: ${error.message}`
      };
    }
  }

  /**
   * 检查TTS服务是否可用
   */
  isAvailable(): boolean {
    const ttsEnabled = configManager.get('ttsEnabled') || false
    const ttsType = configManager.get('ttsType') || 'openai'
    
    if (!ttsEnabled) {
      return false;
    }
    
    // 对于不同类型的TTS，检查不同的配置
    if (ttsType === 'edge') {
      // Edge TTS只需要启用就可以使用，不需要额外配置
      return true;
    } else {
      // OpenAI TTS需要配置API URL和API密钥
      const apiUrl: string = configManager.get('ttsApiUrl') as string || ''
      const apiKey: string = configManager.get('ttsApiKey') as string || ''
      
      console.log('TTSService.isAvailable 检查OpenAI配置:', {
        ttsEnabled,
        apiUrlExists: !!apiUrl,
        apiKeyExists: !!apiKey,
        configValues: {
          ttsEnabled: configManager.get('ttsEnabled'),
          apiUrl: apiUrl ? apiUrl.substring(0, 10) + '...' : '',
          apiKeyLength: apiKey ? apiKey.length : 0
        }
      })
      
      return !!apiUrl && !!apiKey;
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
