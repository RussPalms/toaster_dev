# Reports what Windows says is playing (Spotify, browsers, anything that shows up in the
# Windows media controls) as one JSON line whenever it changes. Toaster's main process
# reads these lines. Run with -Once to print a single reading and exit.
param([switch]$Once)

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

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

# Which player to report. Windows' "current" one is the one used last, which is often a browser
# tab (a stream or a video playing along) while the song comes from somewhere else. So of the
# players that are playing, the one most likely to be playing a song wins: a music app (Spotify,
# Apple Music...), then one that gives an album (Spotify and YouTube Music do, in a browser too; a
# YouTube video or a stream doesn't, though both say "Music"), then a title that reads like a song
# ("official audio", "lyrics", "ft."). A song on plain YouTube still wins when it's the only thing
# playing. Ties go to the one reported last, so two of a kind don't take turns. With nothing
# playing, Windows' pick (paused) is reported.
$musicApps = 'spotify|music|itunes|tidal|deezer|qobuz|foobar|musicbee|winamp|aimp|soundcloud|pandora'
function Score($session, $props, $lastKey) {
  $score = 0
  if ($session.SourceAppUserModelId -match $musicApps) { $score += 4 }
  if ($props.AlbumTitle) { $score += 2 }
  if ($props.Title -match 'official (music )?(video|audio)|lyric|visuali[sz]er|\((audio|official)\)|\bft\.|\bfeat\.') { $score += 1 }
  if ("$($session.SourceAppUserModelId)|$($props.Title)" -eq $lastKey) { $score += 0.5 }
  $score
}

# The cover art, as a data: URL (the players hand it over as a small PNG or JPEG, usually 10-20
# KB). Read again through the song's first 20 seconds and every 15 after: a browser playing a song
# (Spotify in Chrome) gives the title at once and the cover a moment later, with Chrome's own icon
# standing in till then, which stuck when it was read once a song. A read that fails keeps the
# cover there was. The stream comes back as a bare COM object PowerShell won't pass to the .NET
# converter itself, so that's called through reflection, which does.
$artKey = ''
$artAge = 0
$art = $null
$asStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [type[]]@([Windows.Storage.Streams.IInputStream]))
function CoverArt($props) {
  try {
    if (-not $props.Thumbnail) { return $null }
    $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $net = $asStream.Invoke($null, @($stream))
    $mem = New-Object System.IO.MemoryStream
    $net.CopyTo($mem)
    $net.Dispose()
    $bytes = $mem.ToArray()
    if ($bytes.Length -lt 64 -or $bytes.Length -gt 2MB) { return $null }
    $type = if ($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xD8) { 'image/jpeg' } elseif ($bytes[0] -eq 0x89) { 'image/png' } elseif ($stream.ContentType) { $stream.ContentType } else { return $null }
    return "data:$type;base64," + [Convert]::ToBase64String($bytes)
  } catch { return $null }
}

$last = ''
$lastKey = ''
while ($true) {
  $info = [ordered]@{ title = $null; artist = $null; app = $null; playing = $false; art = $null }
  try {
    $session = $null
    $props = $null
    $best = -1
    foreach ($s in $manager.GetSessions()) {
      if ($s.GetPlaybackInfo().PlaybackStatus -ne 'Playing') { continue }
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $score = Score $s $p $lastKey
      if ($score -gt $best) { $session = $s; $props = $p; $best = $score }
    }
    if (-not $session) {
      $session = $manager.GetCurrentSession()
      if ($session) { $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]) }
    }
    if ($session) {
      $info.title = $props.Title
      $info.artist = $props.Artist
      $info.app = $session.SourceAppUserModelId
      $info.playing = ($session.GetPlaybackInfo().PlaybackStatus -eq 'Playing')
      $lastKey = "$($info.app)|$($info.title)"
      if ("$lastKey|$($info.artist)" -ne $artKey) { $artKey = "$lastKey|$($info.artist)"; $artAge = 0 }
      if ($artAge -lt 14 -or $artAge % 10 -eq 0) {
        $fresh = CoverArt $props
        if ($fresh -or $artAge -eq 0) { $art = $fresh }
      }
      $artAge++
      $info.art = $art
    }
  } catch { }
  $json = $info | ConvertTo-Json -Compress
  if ($json -ne $last) {
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
    $last = $json
  }
  if ($Once) { break }
  Start-Sleep -Milliseconds 1500
}
