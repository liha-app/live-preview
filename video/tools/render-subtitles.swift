#!/usr/bin/env swift

import AppKit
import Foundation

guard CommandLine.arguments.count == 4 || CommandLine.arguments.count == 5 else {
  fputs("usage: render-subtitles.swift input.srt output-directory manifest.tsv [subtitle|subtitle-ja|callout]\n", stderr)
  exit(2)
}

let input = URL(fileURLWithPath: CommandLine.arguments[1])
let outputDirectory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
let manifest = URL(fileURLWithPath: CommandLine.arguments[3])
let style = CommandLine.arguments.count == 5 ? CommandLine.arguments[4] : "subtitle"
let source = try String(contentsOf: input, encoding: .utf8)

try FileManager.default.createDirectory(
  at: outputDirectory,
  withIntermediateDirectories: true
)

func seconds(_ clock: String) -> Double {
  let pieces = clock.replacingOccurrences(of: ",", with: ".").split(separator: ":")
  guard pieces.count == 3 else { return 0 }
  let hours = Double(pieces[0]) ?? 0
  let minutes = Double(pieces[1]) ?? 0
  let seconds = Double(pieces[2]) ?? 0
  return hours * 3600 + minutes * 60 + seconds
}

func render(lines: [String], to destination: URL) throws {
  let callout = style == "callout"
  let japanese = style == "subtitle-ja"
  let fontSize: CGFloat = 22
  let fontName = japanese ? "Hiragino Sans W3" : "Arial"
  let font = NSFont(name: fontName, size: fontSize) ?? NSFont.systemFont(ofSize: fontSize, weight: .medium)
  let paragraph = NSMutableParagraphStyle()
  paragraph.alignment = callout ? .left : .center
  paragraph.lineSpacing = callout ? 2 : 4
  let attributes: [NSAttributedString.Key: Any] = [
    .font: font,
    .foregroundColor: NSColor.white,
    .paragraphStyle: paragraph,
  ]
  let text = lines.joined(separator: "\n") as NSString
  let measured = text.boundingRect(
    with: NSSize(width: callout ? 760 : 1400, height: 240),
    options: [.usesLineFragmentOrigin, .usesFontLeading],
    attributes: attributes
  )
  let horizontalPadding: CGFloat = callout ? 18 : 24
  let verticalPadding: CGFloat = callout ? 12 : 12
  let width = ceil(measured.width) + horizontalPadding * 2
  let height = ceil(measured.height) + verticalPadding * 2
  let image = NSImage(size: NSSize(width: width, height: height))
  image.lockFocus()
  NSColor.clear.setFill()
  NSRect(x: 0, y: 0, width: width, height: height).fill()
  NSColor(calibratedWhite: 0.03, alpha: callout ? 0.88 : 0.72).setFill()
  NSBezierPath(
    roundedRect: NSRect(x: 0, y: 0, width: width, height: height),
    xRadius: callout ? 8 : 9,
    yRadius: callout ? 8 : 9
  ).fill()
  text.draw(
    in: NSRect(
      x: horizontalPadding,
      y: verticalPadding,
      width: width - horizontalPadding * 2,
      height: height - verticalPadding * 2
    ),
    withAttributes: attributes
  )
  image.unlockFocus()

  guard
    let tiff = image.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiff),
    let png = bitmap.representation(using: .png, properties: [:])
  else {
    throw NSError(domain: "subtitle-render", code: 1)
  }
  try png.write(to: destination)
}

let blocks = source
  .replacingOccurrences(of: "\r\n", with: "\n")
  .components(separatedBy: "\n\n")
  .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
var rows: [String] = []

for (offset, block) in blocks.enumerated() {
  let lines = block.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
  guard lines.count >= 3 else { continue }
  let times = lines[1].components(separatedBy: " --> ")
  guard times.count == 2 else { continue }
  let file = outputDirectory.appendingPathComponent(String(format: "cue-%03d.png", offset + 1))
  var subtitleLines = Array(lines.dropFirst(2))
  while subtitleLines.last?.isEmpty == true { subtitleLines.removeLast() }
  try render(lines: subtitleLines, to: file)
  rows.append("\(file.path)\t\(String(format: "%.3f", seconds(times[0])))\t\(String(format: "%.3f", seconds(times[1])))")
}

try (rows.joined(separator: "\n") + "\n").write(to: manifest, atomically: true, encoding: .utf8)
print("Rendered \(rows.count) subtitle cards to \(outputDirectory.path)")
