#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/message.h>
#import <objc/runtime.h>
#include <cstring>
#include <node_api.h>

static char localSpaceKey;
static char pendingMoveKey;
static char collapseOnMiniaturizeKey;
static IMP originalPanelSetter = nullptr;
// Null when the hook was added to the panel class itself, which then forwards to its superclass.
static IMP originalPerformMiniaturize = nullptr;
static IMP originalMiniaturize = nullptr;
static bool miniaturizeHooked = false;
static napi_threadsafe_function miniaturizeHandler = nullptr;

static NSWindow *GetWindowFromHandle(napi_env env, napi_value argument) {
  size_t length = 0;
  bool isBuffer = false;
  void *bytes = nullptr;
  if (!argument || napi_is_buffer(env, argument, &isBuffer) != napi_ok || !isBuffer ||
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

static NSWindow *GetWindow(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argument = nullptr;
  napi_get_cb_info(env, info, &argc, &argument, nullptr, nullptr);
  return GetWindowFromHandle(env, argc == 1 ? argument : nullptr);
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

// Electron's minimize event fires after the fact and cannot be cancelled, so marked panels
// hand the yellow light, Cmd+M, and title-bar double clicks to JavaScript instead of the Dock.
static bool RouteMiniaturize(id receiver) {
  if (!miniaturizeHandler || !objc_getAssociatedObject(receiver, &collapseOnMiniaturizeKey)) return false;
  // The content view pointer is what getNativeWindowHandle() returns; JavaScript only compares it.
  NSView *contentView = [(NSWindow *)receiver contentView];
  napi_call_threadsafe_function(miniaturizeHandler, (__bridge void *)contentView, napi_tsfn_nonblocking);
  return true;
}

static void ForwardMiniaturize(id receiver, SEL selector, id sender, IMP original) {
  if (original) {
    reinterpret_cast<void (*)(id, SEL, id)>(original)(receiver, selector, sender);
    return;
  }
  struct objc_super target = {receiver, class_getSuperclass(NSClassFromString(@"ElectronNSPanel"))};
  reinterpret_cast<void (*)(struct objc_super *, SEL, id)>(objc_msgSendSuper)(&target, selector, sender);
}

static void PerformMiniaturize(id receiver, SEL selector, id sender) {
  if (!RouteMiniaturize(receiver)) ForwardMiniaturize(receiver, selector, sender, originalPerformMiniaturize);
}

static void Miniaturize(id receiver, SEL selector, id sender) {
  if (!RouteMiniaturize(receiver)) ForwardMiniaturize(receiver, selector, sender, originalMiniaturize);
}

// Overrides an inherited method on the panel class alone, so other Electron windows keep theirs.
static IMP HookPanelMethod(Class panel, SEL selector, IMP hook) {
  Method inherited = class_getInstanceMethod(panel, selector);
  if (class_addMethod(panel, selector, hook, method_getTypeEncoding(inherited))) return nullptr;
  return method_setImplementation(class_getInstanceMethod(panel, selector), hook);
}

static void CallMiniaturizeHandler(napi_env env, napi_value callback, void *, void *contentView) {
  if (!env || !callback) return;
  napi_value handle, undefined;
  void *bytes;
  napi_create_buffer_copy(env, sizeof(contentView), &contentView, &bytes, &handle);
  napi_get_undefined(env, &undefined);
  napi_call_function(env, undefined, callback, 1, &handle, nullptr);
}

// Node finalizes the thread-safe function itself during teardown; the hooks then forward.
static void ClearMiniaturizeHandler(void *) { miniaturizeHandler = nullptr; }

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

static napi_value SetMiniaturizeHandler(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value callback;
  napi_valuetype type;
  napi_get_cb_info(env, info, &argc, &callback, nullptr, nullptr);
  if (argc != 1 || napi_typeof(env, callback, &type) != napi_ok || type != napi_function) {
    napi_throw_type_error(env, nullptr, "Expected a miniaturize handler function");
    return nullptr;
  }
  if (miniaturizeHandler) {
    napi_release_threadsafe_function(miniaturizeHandler, napi_tsfn_release);
  } else {
    napi_add_env_cleanup_hook(env, ClearMiniaturizeHandler, nullptr);
  }
  napi_value name;
  napi_create_string_utf8(env, "selectionPanelMiniaturize", NAPI_AUTO_LENGTH, &name);
  if (napi_create_threadsafe_function(env, callback, nullptr, name, 0, 1, nullptr, nullptr, nullptr,
                                      CallMiniaturizeHandler, &miniaturizeHandler) != napi_ok) {
    miniaturizeHandler = nullptr;
    napi_throw_error(env, nullptr, "Could not create the miniaturize handler");
    return nullptr;
  }
  // The handler must not keep the app alive at quit.
  napi_unref_threadsafe_function(env, miniaturizeHandler);
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value InterceptMiniaturize(napi_env env, napi_callback_info info) {
  NSWindow *window = GetWindow(env, info);
  if (!window) return nullptr;
  Class panel = NSClassFromString(@"ElectronNSPanel");
  if (!panel || ![window isKindOfClass:panel] || !class_getInstanceMethod(panel, @selector(miniaturize:))) {
    napi_throw_error(env, nullptr, "Expected a supported Electron panel window");
    return nullptr;
  }
  if (!miniaturizeHooked) {
    originalPerformMiniaturize =
        HookPanelMethod(panel, @selector(performMiniaturize:), reinterpret_cast<IMP>(PerformMiniaturize));
    originalMiniaturize = HookPanelMethod(panel, @selector(miniaturize:), reinterpret_cast<IMP>(Miniaturize));
    miniaturizeHooked = true;
  }
  objc_setAssociatedObject(window, &collapseOnMiniaturizeKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

// Reads the focused window of the frontmost app, which may be Cherry itself; false without Accessibility access.
static napi_value IsFrontmostFullScreen(napi_env env, napi_callback_info) {
  bool fullScreen = false;
  NSRunningApplication *app = NSWorkspace.sharedWorkspace.frontmostApplication;
  if (app) {
    AXUIElementRef appElement = AXUIElementCreateApplication(app.processIdentifier);
    // A hung app must not stall the main process for the default six seconds.
    AXUIElementSetMessagingTimeout(appElement, 0.25);
    CFTypeRef window = nullptr;
    if (AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute, &window) == kAXErrorSuccess && window) {
      AXUIElementSetMessagingTimeout(static_cast<AXUIElementRef>(window), 0.25);
      CFTypeRef value = nullptr;
      if (AXUIElementCopyAttributeValue(static_cast<AXUIElementRef>(window), CFSTR("AXFullScreen"), &value) ==
              kAXErrorSuccess &&
          value) {
        fullScreen = CFGetTypeID(value) == CFBooleanGetTypeID() && CFBooleanGetValue(static_cast<CFBooleanRef>(value));
        CFRelease(value);
      }
      CFRelease(window);
    }
    CFRelease(appElement);
  }
  napi_value result;
  napi_get_boolean(env, fullScreen, &result);
  return result;
}

static bool GetNumber(napi_env env, napi_value object, const char *name, double *value) {
  napi_value property;
  return napi_get_named_property(env, object, name, &property) == napi_ok &&
         napi_get_value_double(env, property, value) == napi_ok;
}

static void ResolveAnimation(napi_env env, napi_value, void *deferred, void *) {
  if (!env) return;
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  napi_resolve_deferred(env, static_cast<napi_deferred>(deferred), undefined);
}

// Electron's animated setBounds runs AppKit's resize synchronously, 0.2s per 150px; the animator does not block.
static napi_value AnimateWindow(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value args[4];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  NSWindow *window = GetWindowFromHandle(env, argc == 4 ? args[0] : nullptr);
  if (!window) return nullptr;
  double x, y, width, height, opacity, duration;
  if (!GetNumber(env, args[1], "x", &x) || !GetNumber(env, args[1], "y", &y) ||
      !GetNumber(env, args[1], "width", &width) || !GetNumber(env, args[1], "height", &height) ||
      napi_get_value_double(env, args[2], &opacity) != napi_ok ||
      napi_get_value_double(env, args[3], &duration) != napi_ok) {
    napi_throw_type_error(env, nullptr, "Expected bounds, an opacity, and a duration in milliseconds");
    return nullptr;
  }
  // Electron bounds start at the primary screen's top-left; Cocoa frames start at its bottom-left.
  NSRect primary = NSScreen.screens.firstObject.frame;
  NSRect frame = NSMakeRect(x, NSMaxY(primary) - y - height, width, height);

  napi_deferred deferred;
  napi_value promise, name;
  napi_threadsafe_function done;
  napi_create_promise(env, &deferred, &promise);
  napi_create_string_utf8(env, "selectionPanelAnimation", NAPI_AUTO_LENGTH, &name);
  if (napi_create_threadsafe_function(env, nullptr, nullptr, name, 0, 1, nullptr, nullptr, deferred,
                                      ResolveAnimation, &done) != napi_ok) {
    napi_throw_error(env, nullptr, "Could not create the animation callback");
    return nullptr;
  }
  [NSAnimationContext
      runAnimationGroup:^(NSAnimationContext *context) {
        context.duration = duration / 1000;
        context.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
        [window.animator setFrame:frame display:YES];
        window.animator.alphaValue = opacity;
      }
      completionHandler:^{
        napi_call_threadsafe_function(done, nullptr, napi_tsfn_nonblocking);
        napi_release_threadsafe_function(done, napi_tsfn_release);
      }];
  return promise;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"configurePanel", nullptr, ConfigurePanel, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"moveToActiveSpace", nullptr, MoveToActiveSpace, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setMiniaturizeHandler", nullptr, SetMiniaturizeHandler, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"interceptMiniaturize", nullptr, InterceptMiniaturize, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"isFrontmostFullScreen", nullptr, IsFrontmostFullScreen, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"animateWindow", nullptr, AnimateWindow, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
