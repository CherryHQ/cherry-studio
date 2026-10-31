#include <dlfcn.h>
#include <gdk-pixbuf/gdk-pixbuf.h>
#include <gio/gdesktopappinfo.h>
#include "../externalApp.h"

namespace {
class IconTheme {
 public:
  IconTheme() {
    library_ = dlopen("libgtk-4.so.1", RTLD_LAZY | RTLD_NOLOAD);
    gtk4_ = library_ != nullptr;
    if (!library_) library_ = dlopen("libgtk-3.so.0", RTLD_LAZY | RTLD_NOLOAD);
    if (!library_) return;
    const auto display = Symbol<void* (*)()>("gdk_display_get_default");
    if (!display) return;
    if (!display()) {
      if (gtk4_) {
        const auto init = Symbol<gboolean (*)()>("gtk_init_check");
        if (!init || !init()) return;
      } else {
        const auto init = Symbol<gboolean (*)(int*, char***)>("gtk_init_check");
        if (!init || !init(nullptr, nullptr)) return;
      }
    }
    if (gtk4_) {
      const auto get = Symbol<void* (*)(void*)>("gtk_icon_theme_get_for_display");
      if (get) theme_ = get(display());
    } else {
      const auto get = Symbol<void* (*)()>("gtk_icon_theme_get_default");
      if (get) theme_ = get();
    }
  }
  ~IconTheme() { if (library_) dlclose(library_); }

  GFile* Lookup(GIcon* icon) {
    if (!theme_) return nullptr;
    if (gtk4_) {
      const auto has = Symbol<gboolean (*)(void*, GIcon*)>("gtk_icon_theme_has_gicon");
      const auto lookup = Symbol<GObject* (*)(void*, GIcon*, int, int, int, int)>("gtk_icon_theme_lookup_by_gicon");
      const auto file = Symbol<GFile* (*)(GObject*)>("gtk_icon_paintable_get_file");
      if (!has || !lookup || !file || !has(theme_, icon)) return nullptr;
      g_autoptr(GObject) paintable = lookup(theme_, icon, 32, 1, 0, 0);
      return paintable ? file(paintable) : nullptr;
    }
    const auto lookup = Symbol<GObject* (*)(void*, GIcon*, int, int)>("gtk_icon_theme_lookup_by_gicon");
    const auto filename = Symbol<const char* (*)(GObject*)>("gtk_icon_info_get_filename");
    if (!lookup || !filename) return nullptr;
    g_autoptr(GObject) info = lookup(theme_, icon, 32, 0);
    const char* path = info ? filename(info) : nullptr;
    return path ? g_file_new_for_path(path) : nullptr;
  }

 private:
  template<typename Function> Function Symbol(const char* name) {
    return reinterpret_cast<Function>(dlsym(library_, name));
  }
  void* library_ = nullptr;
  void* theme_ = nullptr;
  bool gtk4_ = false;
};

void LoadIcon(external_app::Application& application, IconTheme& theme) {
  g_autoptr(GDesktopAppInfo) info = g_desktop_app_info_new(application.id.c_str());
  GIcon* icon = info ? g_app_info_get_icon(G_APP_INFO(info)) : nullptr;
  if (!icon) return;
  g_autoptr(GInputStream) stream = nullptr;
  if (G_IS_LOADABLE_ICON(icon)) {
    stream = g_loadable_icon_load(G_LOADABLE_ICON(icon), 32, nullptr, nullptr, nullptr);
  } else {
    g_autoptr(GFile) file = theme.Lookup(icon);
    if (file) stream = G_INPUT_STREAM(g_file_read(file, nullptr, nullptr));
  }
  if (!stream) return;
  g_autoptr(GdkPixbuf) pixbuf = gdk_pixbuf_new_from_stream_at_scale(stream, 32, 32, TRUE, nullptr, nullptr);
  if (!pixbuf) return;
  g_autofree gchar* png = nullptr;
  gsize length = 0;
  if (!gdk_pixbuf_save_to_buffer(pixbuf, &png, &length, "png", nullptr, nullptr)) return;
  g_autofree gchar* encoded = g_base64_encode(reinterpret_cast<const guchar*>(png), length);
  application.iconDataUrl = std::string("data:image/png;base64,") + encoded;
}
}

namespace external_app {
void LoadIcons(Listing& listing) {
  // GTK theme objects belong to the host's main thread and must match its loaded GTK major version.
  IconTheme theme;
  for (auto& application : listing.applications) LoadIcon(application, theme);
  if (listing.defaultApplication) {
    for (const auto& application : listing.applications) {
      if (application.id == listing.defaultApplication->id) {
        listing.defaultApplication->iconDataUrl = application.iconDataUrl;
        return;
      }
    }
    LoadIcon(*listing.defaultApplication, theme);
  }
}
}
