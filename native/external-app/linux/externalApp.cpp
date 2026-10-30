#include <gio/gdesktopappinfo.h>
#include <set>
#include <stdexcept>
#include "../externalApp.h"

namespace {
external_app::Application Metadata(GAppInfo* app) {
  external_app::Application result{g_app_info_get_id(app), g_app_info_get_display_name(app), {}, {}};
  GIcon* icon = g_app_info_get_icon(app);
  if (icon && G_IS_FILE_ICON(icon)) {
    g_autofree gchar* path = g_file_get_path(g_file_icon_get_file(G_FILE_ICON(icon)));
    if (path) result.iconPath = path;
  }
  return result;
}
GList* Applications(GFile* file, GAppInfo** defaultApp) {
  g_autoptr(GFileInfo) info = g_file_query_info(file, G_FILE_ATTRIBUTE_STANDARD_CONTENT_TYPE,
                                              G_FILE_QUERY_INFO_NONE, nullptr, nullptr);
  const char* type = info ? g_file_info_get_content_type(info) : nullptr;
  if (!type) return nullptr;
  *defaultApp = g_app_info_get_default_for_type(type, false);
  GList* result = g_app_info_get_all_for_type(type);
  if (*defaultApp) result = g_list_prepend(result, g_object_ref(*defaultApp));
  return result;
}
bool Visible(GAppInfo* app, GAppInfo* defaultApp) {
  return g_app_info_get_id(app) && (g_app_info_should_show(app) || (defaultApp && g_app_info_equal(app, defaultApp)));
}
}

namespace external_app {
Listing List(const std::string& path) {
  g_autoptr(GFile) file = g_file_new_for_path(path.c_str());
  g_autoptr(GAppInfo) defaultApp = nullptr;
  GList* apps = Applications(file, &defaultApp);
  Listing result;
  if (defaultApp && g_app_info_get_id(defaultApp)) result.defaultApplication = Metadata(defaultApp);
  std::set<std::string> seen;
  for (GList* item = apps; item; item = item->next) {
    auto app = G_APP_INFO(item->data);
    if (!Visible(app, defaultApp) || !seen.insert(g_app_info_get_id(app)).second) continue;
    result.applications.push_back(Metadata(app));
  }
  g_list_free_full(apps, g_object_unref);
  return result;
}
void Open(const std::string& path, const std::string& applicationId) {
  g_autoptr(GFile) file = g_file_new_for_path(path.c_str());
  g_autoptr(GAppInfo) defaultApp = nullptr;
  GList* apps = Applications(file, &defaultApp);
  g_autoptr(GAppInfo) selected = nullptr;
  for (GList* item = apps; item; item = item->next) {
    auto app = G_APP_INFO(item->data);
    if (Visible(app, defaultApp) && applicationId == g_app_info_get_id(app)) {
      selected = G_APP_INFO(g_object_ref(app));
      break;
    }
  }
  g_list_free_full(apps, g_object_unref);
  if (!selected) throw std::runtime_error("Application is no longer associated with this file");
  g_autoptr(GAppLaunchContext) context = g_app_launch_context_new();
  GList files = {file, nullptr, nullptr};
  if (!g_app_info_launch(selected, &files, context, nullptr)) throw std::runtime_error("External application launch failed");
}
}
