# Alternate-day LONG runner for the "ModernMonk Long" task. Free, local.
# Produces one Top-10 long from the "Amazing Places & Earth's Wonders" bank
# (the orchestrator picks the topic when --long-only is set with no --topic).
#
# Resilient to an often-off laptop: fires at 11 AM AND at logon, but a marker
# guarantees it runs at most once every ~2 days (the alternate-day cadence).
#
# Manual test:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-long.ps1

$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\ranap\youtube-automation'
Set-Location $repo

$logDir = Join-Path $repo 'output'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$marker = Join-Path $logDir '.last-long-date'

# Ran a long within the last 2 days already? Then skip (keeps the alternate-day
# cadence even though the task also fires at every logon as a catch-up).
if (Test-Path $marker) {
  try {
    $last = [datetime]::ParseExact((Get-Content $marker -Raw).Trim(), 'yyyyMMdd', $null)
    if (((Get-Date).Date - $last.Date).TotalDays -lt 2) { exit 0 }
  } catch { }
}

$tools = @(
  'C:\Program Files\nodejs',
  'C:\ffmpeg\ffmpeg-master-latest-win64-gpl\bin',
  'C:\Users\ranap\AppData\Local\Programs\Python\Python311-arm64',
  'C:\Users\ranap\AppData\Local\Programs\Python\Python311-arm64\Scripts'
)
$env:PATH = ($tools -join ';') + ';' + $env:PATH
$env:PYTHON_BIN = 'python'

# Keep the PC awake for the whole (~1h) render so sleep can't kill it mid-run
# (this is what terminated the 08-31 long). Reset at the end.
try { Add-Type -Namespace Win32 -Name P -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint e);' -ErrorAction SilentlyContinue } catch { }
try { [Win32.P]::SetThreadExecutionState([uint32]'0x80000001') | Out-Null } catch { }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $logDir "local-long-$stamp.log"
"[$(Get-Date -Format o)] starting alternate-day LONG run" | Out-File -FilePath $log -Encoding utf8
& 'C:\Program Files\nodejs\node.exe' orchestrator.js --long-only --long-count=1 *>> $log
$code = $LASTEXITCODE
"[$(Get-Date -Format o)] finished long run, exit code $code" | Out-File -FilePath $log -Append -Encoding utf8
try { [Win32.P]::SetThreadExecutionState([uint32]'0x80000000') | Out-Null } catch { }

if ($code -eq 0) { (Get-Date -Format 'yyyyMMdd') | Out-File -FilePath $marker -Encoding ascii -NoNewline }
exit $code
