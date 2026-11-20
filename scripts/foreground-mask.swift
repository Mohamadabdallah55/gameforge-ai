import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

struct MaskFailure: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

func separateForeground() throws {
    guard CommandLine.arguments.count == 3 else {
        throw MaskFailure("Expected input and output image paths")
    }
    guard #available(macOS 14, *) else {
        throw MaskFailure("Foreground segmentation requires macOS 14 or later")
    }
    let input = URL(fileURLWithPath: CommandLine.arguments[1])
    guard let source = CGImageSourceCreateWithURL(input as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw MaskFailure("Cannot decode input image")
    }
    let request = VNGenerateForegroundInstanceMaskRequest()
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])
    guard let observation = request.results?.first,
          !observation.allInstances.isEmpty else {
        throw MaskFailure("No separable foreground was detected")
    }
    let pixels = try observation.generateMaskedImage(
        ofInstances: observation.allInstances,
        from: handler,
        croppedToInstancesExtent: false
    )
    let frame = CIImage(cvPixelBuffer: pixels)
    let output = URL(fileURLWithPath: CommandLine.arguments[2])
    guard let rendered = CIContext().createCGImage(frame, from: frame.extent),
          let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        throw MaskFailure("Cannot create foreground PNG")
    }
    CGImageDestinationAddImage(destination, rendered, nil)
    guard CGImageDestinationFinalize(destination) else {
        throw MaskFailure("Cannot save foreground PNG")
    }
}

do {
    try separateForeground()
} catch {
    FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
    exit(1)
}
