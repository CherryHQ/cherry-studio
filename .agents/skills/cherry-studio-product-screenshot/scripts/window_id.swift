#!/usr/bin/env swift

import CoreGraphics
import Foundation

guard (2...3).contains(CommandLine.arguments.count),
      let rawPID = Int32(CommandLine.arguments[1]),
      rawPID > 0 else {
  FileHandle.standardError.write(Data("usage: window_id.swift <pid> [expected-window-id]\n".utf8))
  exit(2)
}

let pid = pid_t(rawPID)
let expectedWindowID = CommandLine.arguments.count == 3 ? UInt32(CommandLine.arguments[2]) : nil

guard let rawWindows = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID)
  as? [[String: Any]] else {
  FileHandle.standardError.write(Data("unable to read window list\n".utf8))
  exit(4)
}

struct Candidate {
  let id: CGWindowID
  let area: CGFloat
}

let candidates = rawWindows.compactMap { window -> Candidate? in
  guard let ownerPID = window[kCGWindowOwnerPID as String] as? Int,
        ownerPID == Int(pid),
        let layer = window[kCGWindowLayer as String] as? Int,
        layer == 0,
        let number = window[kCGWindowNumber as String] as? Int,
        let boundsValue = window[kCGWindowBounds as String] else {
    return nil
  }

  let boundsDictionary = boundsValue as! CFDictionary
  guard let bounds = CGRect(dictionaryRepresentation: boundsDictionary),
        bounds.width >= 400,
        bounds.height >= 300 else {
    return nil
  }

  return Candidate(id: CGWindowID(number), area: bounds.width * bounds.height)
}

guard !candidates.isEmpty else {
  FileHandle.standardError.write(Data("no suitable on-screen layer-0 window for pid \(pid)\n".utf8))
  exit(5)
}

if let expectedWindowID {
  guard let selected = candidates.first(where: { $0.id == expectedWindowID }) else {
    let ids = candidates.map { String($0.id) }.joined(separator: ",")
    FileHandle.standardError.write(Data("window \(expectedWindowID) is not an on-screen layer-0 window for pid \(pid); candidates=\(ids)\n".utf8))
    exit(6)
  }
  print(selected.id)
  exit(0)
}

guard candidates.count == 1, let selected = candidates.first else {
  let ids = candidates.sorted(by: { $0.area > $1.area }).map { String($0.id) }.joined(separator: ",")
  FileHandle.standardError.write(Data("multiple candidate windows for pid \(pid); verify one explicitly: \(ids)\n".utf8))
  exit(7)
}

print(selected.id)
