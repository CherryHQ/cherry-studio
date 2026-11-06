{
  "targets": [{
    "target_name": "selection-panel",
    "sources": ["win32/selectionPanel.cpp", "win32/cursors.rc"],
    "defines": ["NAPI_VERSION=8", "NOMINMAX", "UNICODE", "_UNICODE"],
    "libraries": ["comctl32.lib", "user32.lib"],
    "win_delay_load_hook": "true",
    "msvs_settings": {"VCCLCompilerTool": {"AdditionalOptions": ["/std:c++17", "/utf-8"]}}
  }]
}
