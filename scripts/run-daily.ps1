# Local daily runner for the ModernMonk pipeline — used by the Windows
# Scheduled Task "ModernMonk Daily" so the whole thing runs FREE on this PC
# instead of GitHub Actions. Sets an explicit PATH (Task Scheduler starts with
# a minimal environment), runs the orchestrator, and logs to output\.
#
# Manual test:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-daily.ps1

$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\ranap\youtube-automation'
Set-Location $repo

# Explicit tool locations (from `which` on 2026-08-22) prepended to PATH so
# node/ffmpeg/python/edge-tts resolve regardless of the task's environment.
$tools = @(
  'C:\Program Files\nodejs',
  'C:\ffmpeg\ffmpeg-master-latest-win64-gpl\bin',
  'C:\Users\ranap\AppData\Local\Programs\Python\Python311-arm64',
  'C:\Users\ranap\AppData\Local\Programs\Python\Python311-arm64\Scripts'
)
$env:PATH = ($tools -join ';') + ';' + $env:PATH
$env:PYTHON_BIN = 'python'

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logDir = Join-Path $repo 'output'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "local-run-$stamp.log"

"[$(Get-Date -Format o)] starting local daily run" | Out-File -FilePath $log -Encoding utf8
# Any extra args passed to this script (e.g. --long-only) are forwarded.
& 'C:\Program Files\nodejs\node.exe' orchestrator.js @args *>> $log
$code = $LASTEXITCODE
"[$(Get-Date -Format o)] finished, exit code $code" | Out-File -FilePath $log -Append -Encoding utf8
exit $code
