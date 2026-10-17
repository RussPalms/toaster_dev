// Finds faces in webcam frames with the Mac's own face detector (Vision), for the
// pop-ups that close in on your face and eyes. Toaster's main process writes one frame
// a line to stdin ("<width> <height> <base64 of 8-bit grey pixels>") and reads one line
// back for each: {"faces":[[x,y,w,h],...]} in pixels, biggest face first. The box is
// cropped to the same shape Windows' detector returns (just above the eyebrows to just
// under the mouth), which the eye finder is framed for. Nothing leaves this Mac.

import CoreGraphics
import Foundation
import Vision

let request = VNDetectFaceLandmarksRequest()

func clamp(_ value: CGFloat, _ lo: CGFloat, _ hi: CGFloat) -> CGFloat {
    min(hi, max(lo, value))
}

/// Landmark points are 0-1 inside the face box, origin at its lower left. The picture
/// Toaster sends has its origin at the upper left.
func pixel(_ point: CGPoint, in box: CGRect, width: Int, height: Int) -> CGPoint {
    let nx = box.origin.x + point.x * box.width
    let ny = box.origin.y + point.y * box.height
    return CGPoint(x: nx * CGFloat(width), y: (1 - ny) * CGFloat(height))
}

func points(of region: VNFaceLandmarkRegion2D?, in box: CGRect, width: Int, height: Int) -> [CGPoint] {
    guard let region else { return [] }
    return region.normalizedPoints.map { pixel($0, in: box, width: width, height: height) }
}

func faceBox(_ face: VNFaceObservation, width: Int, height: Int) -> CGRect? {
    let b = face.boundingBox
    let full = CGRect(
        x: b.origin.x * CGFloat(width),
        y: (1 - b.origin.y - b.height) * CGFloat(height),
        width: b.width * CGFloat(width),
        height: b.height * CGFloat(height)
    )
    let brows = points(of: face.landmarks?.leftEyebrow, in: b, width: width, height: height)
        + points(of: face.landmarks?.rightEyebrow, in: b, width: width, height: height)
    let lips = points(of: face.landmarks?.outerLips ?? face.landmarks?.innerLips, in: b, width: width, height: height)
    var rect: CGRect
    if let browTop = brows.map(\.y).min(), let lipBottom = lips.map(\.y).max(), lipBottom > browTop {
        let pad = (lipBottom - browTop) * 0.12
        var left = full.minX
        var right = full.maxX
        let jaw = points(of: face.landmarks?.faceContour, in: b, width: width, height: height)
        if let jawLeft = jaw.map(\.x).min(), let jawRight = jaw.map(\.x).max(), jawRight - jawLeft > full.width * 0.4 {
            let grow = (jawRight - jawLeft) * 0.06
            left = jawLeft - grow
            right = jawRight + grow
        }
        rect = CGRect(x: left, y: browTop - pad, width: right - left, height: (lipBottom + pad * 0.7) - (browTop - pad))
    } else {
        // No landmarks: a full Vision box runs forehead to chin. The middle band of it
        // is the brows-to-mouth box the eye finder expects.
        rect = CGRect(x: full.minX, y: full.minY + full.height * 0.18, width: full.width, height: full.height * 0.60)
    }
    let x = clamp(rect.minX, 0, CGFloat(width - 1))
    let y = clamp(rect.minY, 0, CGFloat(height - 1))
    let maxX = clamp(rect.maxX, x + 1, CGFloat(width))
    let maxY = clamp(rect.maxY, y + 1, CGFloat(height))
    let boxed = CGRect(x: x, y: y, width: maxX - x, height: maxY - y)
    return boxed.width >= 8 && boxed.height >= 8 ? boxed : nil
}

func greyImage(width: Int, height: Int, bytes: Data) -> CGImage? {
    guard bytes.count == width * height, width > 0, height > 0 else { return nil }
    guard let provider = CGDataProvider(data: bytes as CFData) else { return nil }
    return CGImage(
        width: width,
        height: height,
        bitsPerComponent: 8,
        bitsPerPixel: 8,
        bytesPerRow: width,
        space: CGColorSpaceCreateDeviceGray(),
        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
        provider: provider,
        decode: nil,
        shouldInterpolate: false,
        intent: .defaultIntent
    )
}

func jsonString(_ value: String) -> String {
    var out = "\""
    for scalar in value.unicodeScalars {
        switch scalar {
        case "\\": out += "\\\\"
        case "\"": out += "\\\""
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        default:
            if scalar.value < 0x20 { out += String(format: "\\u%04x", scalar.value) }
            else { out.unicodeScalars.append(scalar) }
        }
    }
    out += "\""
    return out
}

func reply(_ faces: [CGRect], error: String? = nil) {
    let boxes = faces.map { "[\(Int($0.minX.rounded())),\(Int($0.minY.rounded())),\(Int($0.width.rounded())),\(Int($0.height.rounded()))]" }
    var line = "{\"faces\":[\(boxes.joined(separator: ","))]"
    if let error { line += ",\"error\":\(jsonString(error))" }
    line += "}"
    print(line)
    fflush(stdout)
}

func find(width: Int, height: Int, bytes: Data) throws -> [CGRect] {
    guard let image = greyImage(width: width, height: height, bytes: bytes) else {
        throw NSError(domain: "toaster.faces", code: 1, userInfo: [NSLocalizedDescriptionKey: "bad frame"])
    }
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])
    let found = (request.results ?? []).compactMap { faceBox($0, width: width, height: height) }
    return found.sorted { $0.width * $0.height > $1.width * $1.height }
}

while let line = readLine() {
    let parts = line.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
    guard parts.count == 3, let width = Int(parts[0]), let height = Int(parts[1]),
          width > 0, height > 0, width <= 2000, height <= 2000,
          let bytes = Data(base64Encoded: String(parts[2]), options: .ignoreUnknownCharacters) else {
        reply([])
        continue
    }
    do {
        reply(try find(width: width, height: height, bytes: bytes))
    } catch {
        reply([], error: error.localizedDescription)
    }
}
