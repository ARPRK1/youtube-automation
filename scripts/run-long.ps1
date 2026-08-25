# Alternate-day LONG-form runner for the Windows Scheduled Task "ModernMonk
# Long". Produces one Top-10 long video from the "Amazing Places & Earth's
# Wonders" bank (niches-long.js) — the orchestrator picks the topic itself when
# --long-only is set with no --topic. Free, local. Logs to output\.
#
# Manual test:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-long.ps1

$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\ranap\youtube-automation'
Set-Location $repo

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
$log = Join-Path $logDir "local-long-$stamp.log"

"[$(Get-Date -Format o)] starting alternate-day LONG run" | Out-File -FilePath $log -Encoding utf8
& 'C:\Program Files\nodejs\node.exe' orchestrator.js --long-only --long-count=1 *>> $log
$code = $LASTEXITCODE
"[$(Get-Date -Format o)] finished long run, exit code $code" | Out-File -FilePath $log -Append -Encoding utf8
exit $code
