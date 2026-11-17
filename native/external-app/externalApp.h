#pragma once

#include <optional>
#include <string>
#include <vector>

namespace external_app {
struct Application {
  std::string id;
  std::string name;
  std::string iconPath;
  std::string iconDataUrl;
};
struct Listing {
  std::vector<Application> applications;
  std::optional<Application> defaultApplication;
};
Listing List(const std::string& path);
#ifdef __linux__
void LoadIcons(Listing& listing);
#endif
void Open(const std::string& path, const std::string& applicationId);
}
