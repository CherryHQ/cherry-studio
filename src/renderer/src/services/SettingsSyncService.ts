/**
 * 设置同步服务
 * 负责在渲染进程和主进程之间同步设置
 */
import store from '@renderer/store'
import { 
  setTtsEnabled, 
  setTtsApiUrl, 
  setTtsApiKey, 
  setTtsModel, 
  setTtsVoice 
} from '@renderer/store/settings'

/**
 * 从主进程加载TTS设置到Redux
 */
export async function loadTTSSettingsFromMain() {
  try {
    console.log('正在从主进程加载TTS设置...');
    
    // 从主进程获取TTS设置
    const ttsEnabled = await window.api.config.get('ttsEnabled');
    const ttsApiUrl = await window.api.config.get('ttsApiUrl');
    const ttsApiKey = await window.api.config.get('ttsApiKey');
    const ttsModel = await window.api.config.get('ttsModel');
    const ttsVoice = await window.api.config.get('ttsVoice');
    
    console.log('从主进程获取到TTS设置:', { 
      ttsEnabled, 
      ttsApiUrl: ttsApiUrl?.substring(0, 10) + '...', 
      apiKeyExists: !!ttsApiKey,
      ttsModel, 
      ttsVoice 
    });
    
    // 更新Redux状态
    const reduxState = store.getState().settings;
    
    // 只有当主进程有值且与Redux不同时才更新
    if (ttsEnabled !== undefined && ttsEnabled !== reduxState.ttsEnabled) {
      store.dispatch(setTtsEnabled(ttsEnabled));
    }
    
    if (ttsApiUrl && ttsApiUrl !== reduxState.ttsApiUrl) {
      store.dispatch(setTtsApiUrl(ttsApiUrl));
    }
    
    if (ttsApiKey && ttsApiKey !== reduxState.ttsApiKey) {
      store.dispatch(setTtsApiKey(ttsApiKey));
    }
    
    if (ttsModel && ttsModel !== reduxState.ttsModel) {
      store.dispatch(setTtsModel(ttsModel));
    }
    
    if (ttsVoice && ttsVoice !== reduxState.ttsVoice) {
      store.dispatch(setTtsVoice(ttsVoice));
    }
    
    // 如果Redux有值而主进程没有，同步到主进程
    if (!ttsEnabled && reduxState.ttsEnabled) {
      window.api.config.set('ttsEnabled', reduxState.ttsEnabled);
    }
    
    if (!ttsApiUrl && reduxState.ttsApiUrl) {
      window.api.config.set('ttsApiUrl', reduxState.ttsApiUrl);
    }
    
    if (!ttsApiKey && reduxState.ttsApiKey) {
      window.api.config.set('ttsApiKey', reduxState.ttsApiKey);
    }
    
    if (!ttsModel && reduxState.ttsModel) {
      window.api.config.set('ttsModel', reduxState.ttsModel);
    }
    
    if (!ttsVoice && reduxState.ttsVoice) {
      window.api.config.set('ttsVoice', reduxState.ttsVoice);
    }
    
    console.log('TTS设置同步完成');
    
    // 检查TTS是否可用
    try {
      // @ts-ignore - tts可能在类型定义中缺失
      const isAvailable = await window.api.tts.isAvailable();
      console.log('TTS服务可用性:', isAvailable);
    } catch (e) {
      console.error('检查TTS可用性失败:', e);
    }
    
    return true;
  } catch (error) {
    console.error('加载TTS设置失败:', error);
    return false;
  }
}

/**
 * 立即同步当前Redux中的TTS设置到主进程
 */
export function syncTTSSettingsToMain() {
  try {
    const { 
      ttsEnabled, 
      ttsApiUrl, 
      ttsApiKey, 
      ttsModel, 
      ttsVoice 
    } = store.getState().settings;
    
    console.log('同步TTS设置到主进程:', { 
      ttsEnabled, 
      ttsApiUrl: ttsApiUrl?.substring(0, 10) + '...', 
      apiKeyExists: !!ttsApiKey,
      ttsModel, 
      ttsVoice 
    });
    
    window.api.config.set('ttsEnabled', ttsEnabled);
    window.api.config.set('ttsApiUrl', ttsApiUrl);
    window.api.config.set('ttsApiKey', ttsApiKey);
    window.api.config.set('ttsModel', ttsModel);
    window.api.config.set('ttsVoice', ttsVoice);
    
    return true;
  } catch (error) {
    console.error('同步TTS设置失败:', error);
    return false;
  }
}
