{
  "targets": [{
    "target_name": "external-app",
    "sources": ["addon.cpp"],
    "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
    "defines": ["NAPI_VERSION=8", "NAPI_CPP_EXCEPTIONS"],
    "cflags_cc!": ["-fno-exceptions"],
    "conditions": [
      ["OS=='mac'", {
        "sources": ["darwin/externalApp.mm"],
        "libraries": ["-framework AppKit"],
        "xcode_settings": {
          "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
          "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
          "CLANG_ENABLE_OBJC_ARC": "YES",
          "MACOSX_DEPLOYMENT_TARGET": "12.0"
        }
      }],
      ["OS=='win'", {
        "sources": ["win32/externalApp.cpp"],
        "defines": ["NOMINMAX", "UNICODE", "_UNICODE"],
        "libraries": ["shell32.lib", "shlwapi.lib", "ole32.lib", "windowscodecs.lib", "crypt32.lib", "gdi32.lib", "user32.lib"],
        "win_delay_load_hook": "true",
        "msvs_settings": {"VCCLCompilerTool": {"ExceptionHandling": 1, "AdditionalOptions": ["/std:c++17", "/utf-8"]}}
      }],
      ["OS=='linux'", {
        "sources": ["linux/externalApp.cpp", "linux/icons.cpp"],
        "cflags_cc": ["-std=c++17", "<!@(pkg-config --cflags gio-unix-2.0 gdk-pixbuf-2.0)"],
        "libraries": ["<!@(pkg-config --libs gio-unix-2.0 gdk-pixbuf-2.0)", "-ldl"]
      }]
    ]
  }]
}
