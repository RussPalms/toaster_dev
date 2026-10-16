# Measures the CPU and memory of a running Toaster over a few seconds.
#   powershell -File tools\measure.ps1 [-Seconds 15] [-Exe <path to the exe to watch>]
# Defaults to the development build (npm start / npm run dev). CPU is shown both as a share of
# the whole machine and as "% of one core" (100% = one core fully busy).
param(
  [int]$Seconds = 15,
  [string]$Exe = (Join-Path $PSScriptRoot '..\node_modules\electron\dist\electron.exe')
)

function Snapshot {
  Get-Process | Where-Object { $_.Path -eq $Exe } | ForEach-Object {
    [pscustomobject]@{ Id = $_.Id; Cpu = $_.TotalProcessorTime.TotalSeconds; Ws = $_.WorkingSet64; Priv = $_.PrivateMemorySize64 }
  }
}

$a = Snapshot
if (-not $a) { 'No running process found for ' + $Exe; exit 1 }
$t0 = Get-Date
Start-Sleep -Seconds $Seconds
$b = Snapshot
$elapsed = ((Get-Date) - $t0).TotalSeconds

$cpu = 0
foreach ($p in $b) {
  $before = $a | Where-Object { $_.Id -eq $p.Id }
  if ($before) { $cpu += $p.Cpu - $before.Cpu }
}
$cores = [Environment]::ProcessorCount
[pscustomobject]@{
  processes      = @($b).Count
  'cpu % of 1 core' = [math]::Round(100 * $cpu / $elapsed, 1)
  'cpu % of machine' = [math]::Round(100 * $cpu / $elapsed / $cores, 1)
  'memory MB'    = [math]::Round((($b | Measure-Object Ws -Sum).Sum) / 1MB, 0)
  'private MB'   = [math]::Round((($b | Measure-Object Priv -Sum).Sum) / 1MB, 0)
} | Format-List | Out-String