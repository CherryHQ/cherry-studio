export function automationBootstrap(): string {
  return `(() => {
    const call = globalThis.__hostCall, print = globalThis.__print;
    delete globalThis.__hostCall; delete globalThis.__print;
    const invoke = async (domain, name, args = {}, target) => {
      const response = JSON.parse(await call(domain, JSON.stringify({name, args, target})));
      if (!response.ok) throw Object.assign(new Error(response.error.message), response.error);
      return response.value;
    };
    const tab = target => Object.freeze({
      getAXState: (options = {}) => invoke('browser', 'getAXState', options, target),
      getScreenshot: (options = {}) => invoke('browser', 'getScreenshot', options, target),
      goto: url => invoke('browser', 'goto', {url}, target),
      evaluate: code => invoke('browser', 'evaluate', {code}, target),
      goBack: () => invoke('browser', 'goBack', {}, target),
      goForward: () => invoke('browser', 'goForward', {}, target),
      waitFor: options => invoke('browser', 'waitFor', options, target),
      listWebTools: () => invoke('browser', 'listWebTools', {}, target),
      callWebTool: (toolId, args = {}) => invoke('browser', 'callWebTool', {toolId, args}, target),
      getConsoleMessages: (options = {}) => invoke('browser', 'getConsoleMessages', options, target),
      getNetworkRequests: (options = {}) => invoke('browser', 'getNetworkRequests', options, target),
      click: (ref, options = {}) => invoke('browser', 'click', {...options, ref}, target),
      hover: ref => invoke('browser', 'hover', {ref}, target),
      type: (ref, text, options = {}) => invoke('browser', 'type', {...options, ref, text}, target),
      pressKey: key => invoke('browser', 'pressKey', {key}, target),
      scroll: (pages, ref) => invoke('browser', 'scroll', {pages, ref}, target),
      selectOption: (ref, values) => invoke('browser', 'selectOption', {ref, values}, target),
      find: query => invoke('browser', 'find', query, target),
      handleDialog: options => invoke('browser', 'handleDialog', options, target)
    });
    const app = target => Object.freeze({
      getAXState: (options = {}) => invoke('computer', 'getAXState', options, target),
      getScreenshot: () => invoke('computer', 'getScreenshot', {}, target),
      getAXStateAndScreenshot: (options = {}) => invoke('computer', 'getAXStateAndScreenshot', options, target),
      click: ref => invoke('computer', 'click', {ref}, target),
      clickAt: (x, y) => invoke('computer', 'clickAt', {x, y}, target),
      drag: (from, to) => invoke('computer', 'drag', {from, to}, target),
      typeText: text => invoke('computer', 'typeText', {text}, target),
      pressKey: key => invoke('computer', 'pressKey', {key}, target),
      setValue: (ref, value) => invoke('computer', 'setValue', {ref, value}, target),
      scroll: (direction, pages, ref) => invoke('computer', 'scroll', {direction, pages, ref}, target),
      performSecondaryAction: (ref, actionId) => invoke('computer', 'performSecondaryAction', {ref, actionId}, target)
    });
    globalThis.browser = Object.freeze({
      getTab: async () => tab((await invoke('browser', 'getTab')).tabId),
      documentation: () => invoke('browser', 'documentation')
    });
    globalThis.computer = Object.freeze({
      getApp: async query => app((await invoke('computer', 'getApp', {query})).target),
      listApps: () => invoke('computer', 'listApps'),
      documentation: () => invoke('computer', 'documentation')
    });
    globalThis.console = Object.freeze({log: (...values) => print(values.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' '))});
  })()`
}
