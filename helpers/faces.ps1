# Finds faces in webcam frames with Windows' own face detector (Windows.Media.FaceAnalysis), for
# the pop-ups that close in on your face and eyes. Toaster's main process writes one frame a
# line to stdin ("<width> <height> <base64 of 8-bit grey pixels>") and reads one line back for
# each: {"faces":[[x,y,w,h],...]} in pixels, biggest face first. Nothing leaves this PC.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

# WinRT calls are async; this turns them into ordinary blocking calls.
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } |
  Select-Object -First 1
function Await($operation, [Type]$resultType) {
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait(-1) | Out-Null
  $task.Result
}

[Windows.Media.FaceAnalysis.FaceDetector,Windows.Media.FaceAnalysis,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.FaceAnalysis.DetectedFace,Windows.Media.FaceAnalysis,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
$detector = Await ([Windows.Media.FaceAnalysis.FaceDetector]::CreateAsync()) ([Windows.Media.FaceAnalysis.FaceDetector])
$listType = [System.Collections.Generic.IList[Windows.Media.FaceAnalysis.DetectedFace]]
$gray8 = [Windows.Graphics.Imaging.BitmapPixelFormat]::Gray8

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $result = '{"faces":[]}'
  try {
    $parts = $line.Split(' ')
    $w = [int]$parts[0]; $h = [int]$parts[1]
    $bytes = [Convert]::FromBase64String($parts[2])
    $buffer = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]::AsBuffer($bytes)
    $bitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::CreateCopyFromBuffer($buffer, $gray8, $w, $h)
    $faces = Await ($detector.DetectFacesAsync($bitmap)) $listType
    $boxes = @($faces | Sort-Object { $_.FaceBox.Width * $_.FaceBox.Height } -Descending |
      ForEach-Object { "[$($_.FaceBox.X),$($_.FaceBox.Y),$($_.FaceBox.Width),$($_.FaceBox.Height)]" })
    $result = '{"faces":[' + ($boxes -join ',') + ']}'
    $bitmap.Dispose()
  } catch {
    $result = '{"faces":[],"error":' + (ConvertTo-Json -Compress ([string]$_.Exception.Message)) + '}'
  }
  [Console]::Out.WriteLine($result)
  [Console]::Out.Flush()
}
