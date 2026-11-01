#include <napi.h>
#include <filesystem>
#include <thread>
#include "externalApp.h"

namespace {
Napi::Object ToObject(Napi::Env env, const external_app::Application& app) {
  auto result = Napi::Object::New(env);
  result.Set("id", app.id);
  result.Set("name", app.name);
  if (!app.iconPath.empty()) result.Set("iconPath", app.iconPath);
  if (!app.iconDataUrl.empty()) result.Set("iconDataUrl", app.iconDataUrl);
  return result;
}

class Work final : public Napi::AsyncWorker {
 public:
  Work(Napi::Env env, std::string path, std::optional<std::string> applicationId)
      : Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)),
        path_(std::move(path)), applicationId_(std::move(applicationId)) {}
  Napi::Promise Promise() const { return deferred_.Promise(); }

 private:
  void Execute() override {
    // Shell COM must own its apartment instead of inheriting another addon's libuv thread state.
    std::thread thread([this] {
      try {
        if (applicationId_) external_app::Open(path_, *applicationId_);
        else listing_ = external_app::List(path_);
      } catch (const std::exception& error) {
        SetError(error.what());
      } catch (...) {
        SetError("External application operation failed");
      }
    });
    thread.join();
  }
  void OnOK() override {
    if (applicationId_) {
      deferred_.Resolve(Env().Undefined());
      return;
    }
#ifdef __linux__
    external_app::LoadIcons(listing_);
#endif
    auto result = Napi::Object::New(Env());
    auto applications = Napi::Array::New(Env(), listing_.applications.size());
    for (size_t i = 0; i < listing_.applications.size(); ++i)
      applications.Set(static_cast<uint32_t>(i), ToObject(Env(), listing_.applications[i]));
    result.Set("applications", applications);
    if (listing_.defaultApplication) result.Set("defaultApplication", ToObject(Env(), *listing_.defaultApplication));
    else result.Set("defaultApplication", Env().Null());
    deferred_.Resolve(result);
  }
  void OnError(const Napi::Error& error) override { deferred_.Reject(error.Value()); }

  Napi::Promise::Deferred deferred_;
  std::string path_;
  std::optional<std::string> applicationId_;
  external_app::Listing listing_;
};

Napi::Value Start(const Napi::CallbackInfo& info, bool open) {
  if (info.Length() != (open ? 2u : 1u) || !info[0].IsString() || (open && !info[1].IsString()))
    throw Napi::TypeError::New(info.Env(), "Expected a file path and, for open, an application identity");
  auto path = info[0].As<Napi::String>().Utf8Value();
  if (path.find('\0') != std::string::npos || !std::filesystem::u8path(path).is_absolute())
    throw Napi::TypeError::New(info.Env(), "Expected an absolute file path");
  std::optional<std::string> id;
  if (open) {
    id = info[1].As<Napi::String>().Utf8Value();
    if (id->empty() || id->find('\0') != std::string::npos)
      throw Napi::TypeError::New(info.Env(), "Expected an application identity");
  }
  auto worker = new Work(info.Env(), std::move(path), std::move(id));
  auto promise = worker->Promise();
  worker->Queue();
  return promise;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("list", Napi::Function::New(env, [](const Napi::CallbackInfo& info) { return Start(info, false); }));
  exports.Set("open", Napi::Function::New(env, [](const Napi::CallbackInfo& info) { return Start(info, true); }));
  return exports;
}
}
NODE_API_MODULE(external_app, Init)
