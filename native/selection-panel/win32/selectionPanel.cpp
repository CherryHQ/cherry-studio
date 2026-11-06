#include <windows.h>
#include <commctrl.h>
#include <node_api.h>
#include <cstring>
#include <memory>
#include <unordered_map>

namespace {
constexpr UINT_PTR kSubclassId = 1;
struct CursorEnvironment;
struct WindowCursor {
  HWND window;
  CursorEnvironment *environment;
  HCURSOR grab = nullptr;
  HCURSOR grabbing = nullptr;
  bool enabled = true;
  bool dragging = false;
  ~WindowCursor() {
    if (GetCursor() == grab || GetCursor() == grabbing) SetCursor(LoadCursorW(nullptr, IDC_ARROW));
    if (grab) DestroyCursor(grab);
    if (grabbing) DestroyCursor(grabbing);
  }
};
struct CursorEnvironment {
  HMODULE module = nullptr;
  std::unordered_map<HWND, std::shared_ptr<WindowCursor>> windows;
};
LRESULT CALLBACK CursorProc(HWND, UINT, WPARAM, LPARAM, UINT_PTR, DWORD_PTR);

void AttachChildren(const std::shared_ptr<WindowCursor> &state) {
  EnumChildWindows(state->window, [](HWND child, LPARAM data) -> BOOL {
    const auto &state = *reinterpret_cast<const std::shared_ptr<WindowCursor> *>(data);
    auto *environment = state->environment;
    if (!environment->windows.count(child) && GetWindowThreadProcessId(child, nullptr) == GetCurrentThreadId()) {
      environment->windows.emplace(child, state);
      if (!SetWindowSubclass(child, CursorProc, kSubclassId, reinterpret_cast<DWORD_PTR>(environment)))
        environment->windows.erase(child);
    }
    return TRUE;
  }, reinterpret_cast<LPARAM>(&state));
}

bool IsDragRegion(WindowCursor *state) {
  POINT point;
  return GetCursorPos(&point) &&
      SendMessageW(state->window, WM_NCHITTEST, 0, MAKELPARAM(point.x, point.y)) == HTCAPTION;
}

bool CanClaimCursor(WindowCursor *state) {
  return state->enabled && IsWindowVisible(state->window) && !IsIconic(state->window) &&
      !(GetWindowLongPtrW(state->window, GWL_EXSTYLE) & WS_EX_TRANSPARENT);
}

void StopDragging(WindowCursor *state) {
  KillTimer(state->window, reinterpret_cast<UINT_PTR>(state));
  state->dragging = false;
}

void ClearCursor(WindowCursor *state) {
  StopDragging(state);
  if (GetCursor() == state->grab || GetCursor() == state->grabbing)
    SetCursor(LoadCursorW(nullptr, IDC_ARROW));
}

void RestoreHover(WindowCursor *state) {
  POINT point;
  if (CanClaimCursor(state) && GetCursorPos(&point) &&
      GetAncestor(WindowFromPoint(point), GA_ROOT) == state->window &&
      SendMessageW(state->window, WM_NCHITTEST, 0, MAKELPARAM(point.x, point.y)) == HTCAPTION) {
    SetCursor(state->grab);
  } else if (GetCursor() == state->grabbing || GetCursor() == state->grab) {
    SetCursor(LoadCursorW(nullptr, IDC_ARROW));
  }
}

void StartDragging(WindowCursor *state) {
  state->dragging = true;
  SetCursor(state->grabbing);
  // Windows' native move loop can reset the cursor without another WM_SETCURSOR.
  SetTimer(state->window, reinterpret_cast<UINT_PTR>(state), 16, nullptr);
}

LRESULT CALLBACK CursorProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam,
                            UINT_PTR subclassId, DWORD_PTR data) {
  auto *environment = reinterpret_cast<CursorEnvironment *>(data);
  const auto retained = environment->windows.at(window);
  auto *state = retained.get();
  if (window == state->window && message == WM_NCHITTEST) {
    const LRESULT result = DefSubclassProc(window, message, wParam, lParam);
    AttachChildren(retained);
    return result;
  }
  if (message == WM_NCDESTROY) {
    if (window == state->window) ClearCursor(state);
    RemoveWindowSubclass(window, CursorProc, subclassId);
    environment->windows.erase(window);
    return DefSubclassProc(window, message, wParam, lParam);
  }
  if (window == state->window &&
      ((message == WM_SHOWWINDOW && !wParam) || (message == WM_SIZE && wParam == SIZE_MINIMIZED) ||
       message == WM_CANCELMODE || (message == WM_STYLECHANGED && !CanClaimCursor(state)))) {
    ClearCursor(state);
  }
  if (message == WM_SETCURSOR && CanClaimCursor(state)) {
    if (state->dragging && (GetAsyncKeyState(VK_LBUTTON) & 0x8000)) {
      SetCursor(state->grabbing);
      return TRUE;
    }
    if (IsDragRegion(state)) {
      SetCursor(state->grab);
      return TRUE;
    }
  }
  if (message == WM_TIMER && wParam == reinterpret_cast<UINT_PTR>(state)) {
    if (!state->dragging) return 0;
    if (CanClaimCursor(state) && (GetAsyncKeyState(VK_LBUTTON) & 0x8000)) {
      SetCursor(state->grabbing);
    } else {
      StopDragging(state);
      RestoreHover(state);
    }
    return 0;
  }
  if (((message == WM_LBUTTONDOWN && IsDragRegion(state)) ||
       (message == WM_NCLBUTTONDOWN && wParam == HTCAPTION) ||
       (message == WM_SYSCOMMAND && (wParam & 0xfff0) == SC_MOVE)) &&
      CanClaimCursor(state) && (GetAsyncKeyState(VK_LBUTTON) & 0x8000)) {
    StartDragging(state);
    const LRESULT result = DefSubclassProc(window, message, wParam, lParam);
    DWORD_PTR current = 0;
    // Native movement dispatches nested messages, including possible window destruction.
    if (GetWindowSubclass(window, CursorProc, subclassId, &current) && current == data) {
      if (state->dragging && CanClaimCursor(state) && (GetAsyncKeyState(VK_LBUTTON) & 0x8000)) {
        SetCursor(state->grabbing);
      } else {
        StopDragging(state);
        RestoreHover(state);
      }
    }
    return result;
  }
  if (window == state->window && message == WM_EXITSIZEMOVE) {
    StopDragging(state);
    RestoreHover(state);
  }
  if ((message == WM_LBUTTONUP || message == WM_NCLBUTTONUP) && state->dragging) {
    StopDragging(state);
    const LRESULT result = DefSubclassProc(window, message, wParam, lParam);
    RestoreHover(state);
    return result;
  }
  const LRESULT result = DefSubclassProc(window, message, wParam, lParam);
  if ((message == WM_MOUSEMOVE || message == WM_NCMOUSEMOVE) && CanClaimCursor(state) &&
      !state->dragging && IsDragRegion(state)) {
    SetCursor(state->grab);
  }
  return result;
}

void Cleanup(void *data) {
  auto *environment = static_cast<CursorEnvironment *>(data);
  for (auto &[window, state] : environment->windows) {
    ClearCursor(state.get());
    RemoveWindowSubclass(window, CursorProc, kSubclassId);
  }
  delete environment;
}

napi_value EnableDragCursor(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value arguments[2] = {};
  void *data = nullptr;
  napi_get_cb_info(env, info, &argc, arguments, nullptr, &data);
  const napi_value argument = argc ? arguments[0] : nullptr;
  bool enabled = true;
  if (argc > 1 && napi_get_value_bool(env, arguments[1], &enabled) != napi_ok) {
    napi_throw_type_error(env, nullptr, "Expected a drag cursor enabled boolean");
    return nullptr;
  }
  bool isBuffer = false;
  size_t size = 0;
  void *bytes = nullptr;
  if (!argument || napi_is_buffer(env, argument, &isBuffer) != napi_ok || !isBuffer ||
      napi_get_buffer_info(env, argument, &bytes, &size) != napi_ok || size != sizeof(HWND)) {
    napi_throw_type_error(env, nullptr, "Expected a native window handle Buffer");
    return nullptr;
  }
  HWND window;
  std::memcpy(&window, bytes, sizeof(window));
  DWORD process = 0;
  const DWORD thread = GetWindowThreadProcessId(window, &process);
  if (!IsWindow(window) || process != GetCurrentProcessId() || thread != GetCurrentThreadId()) {
    napi_throw_error(env, nullptr, "Native handle must belong to a live window on the current thread");
    return nullptr;
  }
  auto *environment = static_cast<CursorEnvironment *>(data);
  if (!environment->windows.count(window)) {
    auto state = std::make_shared<WindowCursor>();
    state->window = window;
    state->environment = environment;
    const UINT dpi = GetDpiForWindow(window);
    const int width = GetSystemMetricsForDpi(SM_CXCURSOR, dpi);
    const int height = GetSystemMetricsForDpi(SM_CYCURSOR, dpi);
    state->grab = static_cast<HCURSOR>(LoadImageW(environment->module, MAKEINTRESOURCEW(101),
                                                IMAGE_CURSOR, width, height, 0));
    state->grabbing = static_cast<HCURSOR>(LoadImageW(environment->module, MAKEINTRESOURCEW(102),
                                                    IMAGE_CURSOR, width, height, 0));
    if (!state->grab || !state->grabbing) {
      napi_throw_error(env, nullptr, "Failed to load native drag cursors");
      return nullptr;
    }
    environment->windows.emplace(window, state);
    if (!SetWindowSubclass(window, CursorProc, kSubclassId, reinterpret_cast<DWORD_PTR>(environment))) {
      environment->windows.erase(window);
      napi_throw_error(env, nullptr, "Failed to install native drag cursor handler");
      return nullptr;
    }
    AttachChildren(state);
  }
  auto *state = environment->windows.at(window).get();
  state->enabled = enabled;
  if (!enabled) ClearCursor(state);
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  auto *environment = new CursorEnvironment();
  GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                     reinterpret_cast<LPCWSTR>(Init), &environment->module);
  napi_add_env_cleanup_hook(env, Cleanup, environment);
  napi_property_descriptor property = {
    "enableDragCursor", nullptr, EnableDragCursor, nullptr, nullptr, nullptr, napi_default, environment
  };
  napi_define_properties(env, exports, 1, &property);
  return exports;
}
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
