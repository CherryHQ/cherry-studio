#import <AppKit/AppKit.h>
#import <objc/message.h>
#import <objc/runtime.h>
#include <cstring>
#include <node_api.h>

static char localSpaceKey;
static char pendingMoveKey;
static IMP originalPanelSetter = nullptr;

static NSWindow *GetWindow(napi_env env, napi_callback_info info) {
  size_t argc = 1, length = 0;
  napi_value argument;
  bool isBuffer = false;
  void *bytes = nullptr;
  napi_get_cb_info(env, info, &argc, &argument, nullptr, nullptr);
  if (argc != 1 || napi_is_buffer(env, argument, &isBuffer) != napi_ok || !isBuffer ||
      napi_get_buffer_info(env, argument, &bytes, &length) != napi_ok || length != sizeof(void *)) {
    napi_throw_type_error(env, nullptr, "Expected a native window handle Buffer");
    return nil;
  }
  if (![NSThread isMainThread]) {
    napi_throw_error(env, nullptr, "Window operations require the AppKit main thread");
    return nil;
  }
  void *pointer;
  std::memcpy(&pointer, bytes, sizeof(pointer));
  for (NSWindow *window in NSApp.windows) {
    if ((__bridge void *)window.contentView == pointer) return window;
  }
  napi_throw_error(env, nullptr, "Native handle does not belong to a live window");
  return nil;
}

static void SetPanelBehavior(id receiver, SEL selector, NSWindowCollectionBehavior behavior) {
  if (!objc_getAssociatedObject(receiver, &localSpaceKey)) {
    reinterpret_cast<void (*)(id, SEL, NSWindowCollectionBehavior)>(originalPanelSetter)(receiver, selector, behavior);
    return;
  }
  // Bypass Electron's forced CanJoinAllSpaces without replacing the object's KVO class.
  struct objc_super target = {receiver, class_getSuperclass(NSClassFromString(@"ElectronNSPanel"))};
  behavior &= ~(NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenPrimary);
  behavior |= NSWindowCollectionBehaviorFullScreenAuxiliary;
  reinterpret_cast<void (*)(struct objc_super *, SEL, NSWindowCollectionBehavior)>(objc_msgSendSuper)(
      &target, selector, behavior);
}

static void RestorePanelSetter(void *) {
  Method setter = class_getInstanceMethod(NSClassFromString(@"ElectronNSPanel"), @selector(setCollectionBehavior:));
  if (setter && originalPanelSetter && method_getImplementation(setter) == reinterpret_cast<IMP>(SetPanelBehavior)) {
    method_setImplementation(setter, originalPanelSetter);
  }
  originalPanelSetter = nullptr;
}

static napi_value ConfigurePanel(napi_env env, napi_callback_info info) {
  NSWindow *window = GetWindow(env, info);
  if (!window) return nullptr;
  Class panel = NSClassFromString(@"ElectronNSPanel");
  Method setter = panel ? class_getInstanceMethod(panel, @selector(setCollectionBehavior:)) : nullptr;
  if (!setter || ![window isKindOfClass:panel]) {
    napi_throw_error(env, nullptr, "Expected a supported Electron panel window");
    return nullptr;
  }
  if (!originalPanelSetter) {
    originalPanelSetter = method_setImplementation(setter, reinterpret_cast<IMP>(SetPanelBehavior));
    napi_add_env_cleanup_hook(env, RestorePanelSetter, nullptr);
  }
  objc_setAssociatedObject(window, &localSpaceKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  window.collectionBehavior = window.collectionBehavior;
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value MoveToActiveSpace(napi_env env, napi_callback_info info) {
  NSWindow *window = GetWindow(env, info);
  if (!window) return nullptr;
  if (!objc_getAssociatedObject(window, &localSpaceKey)) {
    napi_throw_error(env, nullptr, "Panel must be configured before moving it");
    return nullptr;
  }
  NSObject *token = [[NSObject alloc] init];
  objc_setAssociatedObject(window, &pendingMoveKey, token, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  window.collectionBehavior &= ~NSWindowCollectionBehaviorMoveToActiveSpace;
  window.collectionBehavior |= NSWindowCollectionBehaviorMoveToActiveSpace;
  [window orderFrontRegardless];
  // AppKit consumes the move asynchronously; only the latest request may clear it.
  __weak NSWindow *weakWindow = window;
  dispatch_async(dispatch_get_main_queue(), ^{
    NSWindow *liveWindow = weakWindow;
    if (liveWindow && objc_getAssociatedObject(liveWindow, &pendingMoveKey) == token) {
      liveWindow.collectionBehavior &= ~NSWindowCollectionBehaviorMoveToActiveSpace;
      objc_setAssociatedObject(liveWindow, &pendingMoveKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
  });
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"configurePanel", nullptr, ConfigurePanel, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"moveToActiveSpace", nullptr, MoveToActiveSpace, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
