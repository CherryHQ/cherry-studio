#include <windows.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <wrl/client.h>
#include <wincodec.h>
#include <wincrypt.h>
#include <filesystem>
#include <set>
#include <stdexcept>
#include "../externalApp.h"

using Microsoft::WRL::ComPtr;
namespace {
void Check(HRESULT result) {
  if (FAILED(result)) throw std::runtime_error("Windows file association operation failed");
}
struct Apartment {
  Apartment() { Check(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED)); }
  ~Apartment() { CoUninitialize(); }
};
std::wstring Wide(const std::string& text) {
  int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), nullptr, 0);
  if (!size) throw std::runtime_error("Invalid UTF-8");
  std::wstring result(size, L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), result.data(), size);
  return result;
}
std::string Utf8(const std::wstring& text) {
  if (text.empty()) return {};
  int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), nullptr, 0, nullptr, nullptr);
  if (!size) throw std::runtime_error("Invalid UTF-16");
  std::string result(size, '\0');
  WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), result.data(), size, nullptr, nullptr);
  return result;
}
std::wstring TakeString(PWSTR value) {
  std::wstring result = value ? value : L"";
  CoTaskMemFree(value);
  return result;
}
std::wstring Association(const std::wstring& extension, ASSOCSTR field) {
  DWORD length = 0;
  AssocQueryStringW(ASSOCF_NONE, field, extension.c_str(), nullptr, nullptr, &length);
  if (!length) return {};
  std::wstring result(length, L'\0');
  if (FAILED(AssocQueryStringW(ASSOCF_NONE, field, extension.c_str(), nullptr, result.data(), &length))) return {};
  result.resize(wcslen(result.c_str()));
  return result;
}
bool SameIdentity(const std::wstring& a, const std::wstring& b) {
  return !a.empty() && !b.empty() && CompareStringOrdinal(a.c_str(), -1, b.c_str(), -1, TRUE) == CSTR_EQUAL;
}
ComPtr<IEnumAssocHandlers> Handlers(const std::wstring& extension) {
  ComPtr<IEnumAssocHandlers> result;
  if (!extension.empty()) Check(SHAssocEnumHandlers(extension.c_str(), ASSOC_FILTER_NONE, &result));
  return result;
}
std::wstring Identity(IAssocHandler* handler) {
  PWSTR name = nullptr;
  Check(handler->GetName(&name));
  return TakeString(name);
}

std::string EncodeIcon(IWICImagingFactory* factory, IWICBitmapSource* bitmap) {
  ComPtr<IStream> stream;
  ComPtr<IWICBitmapEncoder> encoder;
  ComPtr<IWICBitmapFrameEncode> frame;
  if (FAILED(CreateStreamOnHGlobal(nullptr, TRUE, &stream)) ||
      FAILED(factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, &encoder)) ||
      FAILED(encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache)) ||
      FAILED(encoder->CreateNewFrame(&frame, nullptr)) || FAILED(frame->Initialize(nullptr)) ||
      FAILED(frame->WriteSource(bitmap, nullptr)) || FAILED(frame->Commit()) || FAILED(encoder->Commit())) return {};
  STATSTG stat{};
  if (FAILED(stream->Stat(&stat, STATFLAG_NONAME)) || stat.cbSize.HighPart || !stat.cbSize.LowPart) return {};
  HGLOBAL memory = nullptr;
  if (FAILED(GetHGlobalFromStream(stream.Get(), &memory))) return {};
  auto bytes = static_cast<const BYTE*>(GlobalLock(memory));
  if (!bytes) return {};
  DWORD size = 0;
  const DWORD flags = CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF;
  std::string encoded;
  if (CryptBinaryToStringA(bytes, stat.cbSize.LowPart, flags, nullptr, &size)) {
    encoded.resize(size);
    if (CryptBinaryToStringA(bytes, stat.cbSize.LowPart, flags, encoded.data(), &size)) encoded.resize(size);
    else encoded.clear();
  }
  GlobalUnlock(memory);
  while (!encoded.empty() && encoded.back() == '\0') encoded.pop_back();
  return encoded.empty() ? std::string{} : "data:image/png;base64," + encoded;
}

std::string Icon(IAssocHandler* handler, const std::wstring& id) {
  ComPtr<IWICImagingFactory> factory;
  if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory)))) return {};
  ComPtr<IWICBitmap> bitmap;
  if (!std::filesystem::path(id).is_absolute()) {
    ComPtr<IShellItemImageFactory> item;
    const auto parsingName = L"shell:AppsFolder\\" + id;
    HBITMAP image = nullptr;
    if (SUCCEEDED(SHCreateItemFromParsingName(parsingName.c_str(), nullptr, IID_PPV_ARGS(&item))) &&
        SUCCEEDED(item->GetImage({32, 32}, SIIGBF_ICONONLY, &image))) {
      const HRESULT result = factory->CreateBitmapFromHBITMAP(image, nullptr, WICBitmapUseAlpha, &bitmap);
      DeleteObject(image);
      if (SUCCEEDED(result)) return EncodeIcon(factory.Get(), bitmap.Get());
    }
  }
  PWSTR rawPath = nullptr;
  int index = 0;
  const HRESULT location = handler->GetIconLocation(&rawPath, &index);
  const auto iconPath = TakeString(rawPath);
  if (FAILED(location) || iconPath.empty()) return {};
  HICON icon = nullptr;
  if (FAILED(SHDefExtractIconW(iconPath.c_str(), index, 0, &icon, nullptr, 32)) || !icon) return {};
  const HRESULT result = factory->CreateBitmapFromHICON(icon, &bitmap);
  DestroyIcon(icon);
  return SUCCEEDED(result) ? EncodeIcon(factory.Get(), bitmap.Get()) : std::string{};
}
}
namespace external_app {
Listing List(const std::string& path) {
  Apartment apartment;
  const auto extension = std::filesystem::path(Wide(path)).extension().wstring();
  const auto defaultExe = extension.empty() ? L"" : Association(extension, ASSOCSTR_EXECUTABLE);
  const auto defaultAppId = extension.empty() ? L"" : Association(extension, ASSOCSTR_APPID);
  Listing result;
  auto enumeration = Handlers(extension);
  ComPtr<IAssocHandler> handler;
  std::set<std::wstring> seen;
  while (enumeration && enumeration->Next(1, handler.ReleaseAndGetAddressOf(), nullptr) == S_OK) {
    const auto id = Identity(handler.Get());
    if (id.empty() || !seen.insert(id).second) continue;
    PWSTR rawName = nullptr;
    handler->GetUIName(&rawName);
    const auto name = TakeString(rawName);
    Application entry{Utf8(id), Utf8(name.empty() ? std::filesystem::path(id).filename().wstring() : name), {}, {}};
    if (std::filesystem::path(id).is_absolute()) entry.iconPath = Utf8(id);
    entry.iconDataUrl = Icon(handler.Get(), id);
    result.applications.push_back(entry);
    if (SameIdentity(id, defaultExe) || SameIdentity(id, defaultAppId)) result.defaultApplication = entry;
  }
  if (!result.defaultApplication && !extension.empty()) {
    const auto name = Association(extension, ASSOCSTR_FRIENDLYAPPNAME);
    if (!name.empty()) result.defaultApplication = Application{Utf8(defaultAppId.empty() ? defaultExe : defaultAppId), Utf8(name), Utf8(defaultExe), {}};
  }
  return result;
}
void Open(const std::string& path, const std::string& applicationId) {
  Apartment apartment;
  const auto file = Wide(path);
  const auto selectedId = Wide(applicationId);
  auto enumeration = Handlers(std::filesystem::path(file).extension().wstring());
  ComPtr<IAssocHandler> handler;
  while (enumeration && enumeration->Next(1, handler.ReleaseAndGetAddressOf(), nullptr) == S_OK) {
    if (Identity(handler.Get()) != selectedId) continue;
    PIDLIST_ABSOLUTE pidl = nullptr;
    Check(SHParseDisplayName(file.c_str(), nullptr, &pidl, 0, nullptr));
    ComPtr<IShellFolder> parent;
    PCUITEMID_CHILD child = nullptr;
    HRESULT result = SHBindToParent(pidl, IID_PPV_ARGS(&parent), &child);
    ComPtr<IDataObject> data;
    if (SUCCEEDED(result)) result = parent->GetUIObjectOf(nullptr, 1, &child, IID_IDataObject, nullptr,
                                                       reinterpret_cast<void**>(data.GetAddressOf()));
    CoTaskMemFree(pidl);
    Check(result);
    Check(handler->Invoke(data.Get()));
    return;
  }
  throw std::runtime_error("Application is no longer associated with this file");
}
}
