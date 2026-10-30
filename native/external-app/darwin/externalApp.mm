#import <AppKit/AppKit.h>
#include <set>
#include <stdexcept>
#include "../externalApp.h"

namespace {
std::string Identity(NSURL* url) { return url.URLByResolvingSymlinksInPath.path.UTF8String; }

std::string Icon(NSURL* url) {
  NSImage* image = [[NSWorkspace sharedWorkspace] iconForFile:url.path];
  NSBitmapImageRep* bitmap = [[NSBitmapImageRep alloc]
    initWithBitmapDataPlanes:nil pixelsWide:32 pixelsHigh:32 bitsPerSample:8 samplesPerPixel:4
    hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
  NSGraphicsContext* context = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
  if (!image || !context) return {};
  [NSGraphicsContext saveGraphicsState];
  [NSGraphicsContext setCurrentContext:context];
  [image drawInRect:NSMakeRect(0, 0, 32, 32) fromRect:NSZeroRect
    operation:NSCompositingOperationCopy fraction:1.0 respectFlipped:NO hints:nil];
  [NSGraphicsContext restoreGraphicsState];
  NSData* png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  if (!png.length) return {};
  return std::string("data:image/png;base64,") + [png base64EncodedStringWithOptions:0].UTF8String;
}

external_app::Application Metadata(NSURL* url) {
  NSBundle* bundle = [NSBundle bundleWithURL:url];
  NSString* name = [bundle objectForInfoDictionaryKey:@"CFBundleDisplayName"];
  if (![name isKindOfClass:[NSString class]] || !name.length)
    name = [[NSFileManager defaultManager] displayNameAtPath:url.path];
  return {Identity(url), name.UTF8String, {}, Icon(url)};
}

NSArray<NSURL*>* Applications(NSURL* file) {
  NSWorkspace* workspace = [NSWorkspace sharedWorkspace];
  NSMutableArray<NSURL*>* apps = [[workspace URLsForApplicationsToOpenURL:file] mutableCopy];
  NSURL* defaultApp = [workspace URLForApplicationToOpenURL:file];
  if (defaultApp) [apps insertObject:defaultApp atIndex:0];
  return apps;
}
}

namespace external_app {
Listing List(const std::string& path) {
  @autoreleasepool {
    NSURL* file = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path.c_str()]];
    Listing result;
    NSURL* defaultApp = [[NSWorkspace sharedWorkspace] URLForApplicationToOpenURL:file];
    if (defaultApp) result.defaultApplication = Metadata(defaultApp);
    std::set<std::string> seen;
    for (NSURL* app in Applications(file)) {
      auto entry = Metadata(app);
      if (seen.insert(entry.id).second) result.applications.push_back(std::move(entry));
    }
    return result;
  }
}

void Open(const std::string& path, const std::string& applicationId) {
  @autoreleasepool {
    NSURL* file = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path.c_str()]];
    NSURL* selected = nil;
    for (NSURL* app in Applications(file)) {
      if (Identity(app) == applicationId) { selected = app; break; }
    }
    if (!selected) throw std::runtime_error("Application is no longer associated with this file");
    auto semaphore = dispatch_semaphore_create(0);
    __block bool succeeded = false;
    [[NSWorkspace sharedWorkspace] openURLs:@[file] withApplicationAtURL:selected
      configuration:[NSWorkspaceOpenConfiguration configuration]
      completionHandler:^(NSRunningApplication* app, NSError* error) {
        succeeded = app != nil && error == nil;
        dispatch_semaphore_signal(semaphore);
      }];
    if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC)) != 0)
      throw std::runtime_error("External application launch timed out");
    if (!succeeded) throw std::runtime_error("External application launch failed");
  }
}
}
