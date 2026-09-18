const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('systemSpeechValidation', {
  complete: (result) => ipcRenderer.send('system-speech-validation:complete', result),
  fail: (message) => ipcRenderer.send('system-speech-validation:failed', message),
  readSourceWav: () => ipcRenderer.invoke('system-speech-validation:source-wav')
})
