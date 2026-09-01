# Local daily SHORTS runner for the "ModernMonk Daily" task. Free, local.
#
# Resilient to a laptop that's often off: the task fires BOTH at 6 PM AND at
# logon (and catches up when the PC next turns on), while a once-per-day marker
# guarantees it runs at most once per calendar day so it never double-posts.
#
# Manual test:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-daily.ps1

$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\ranap\youtube-automation'
Set-Location $repo

$logDir = Join-Path $repo 'output'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$marker = Join-Path $logDir '.last-shorts-date'
$today  = Get-Date -Format 'yyyyMMdd'

# Already produced today? (6 PM trigger and the logon catch-up must not both run.)
if ((Test-Path $marker) -and ((Get-Content $marker -Raw -ErrorAction SilentlyContinue).Trim() -eq $today)) {
  exit 0
}

$tools = @(
  'C:\Program Files\nodejs',
  'C:\ffmpeg\ffmpeg-master-latest-win64-gpl\bin',
  'C:\Users\ranap\AppData\Local\Programs\Python\Python311-arm64',
  'C:\Users\ranap\AppData\Local\Programs\Python\Python311-arm64\Scripts'
)
$env:PATH = ($tools -join ';') + ';' + $env:PATH
$env:PYTHON_BIN = 'python'

# Keep the PC awake for the whole run so it isn't killed mid-render if the
# machine would otherwise sleep (ES_CONTINUOUS | ES_SYSTEM_REQUIRED). Reset at
# the end. (Does not stop a manual shutdown.)
try { Add-Type -Namespace Win32 -Name P -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint e);' -ErrorAction SilentlyContinue } catch { }
try { [Win32.P]::SetThreadExecutionState([uint32]'0x80000001') | Out-Null } catch { }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $logDir "local-run-$stamp.log"
"[$(Get-Date -Format o)] starting local daily SHORTS run" | Out-File -FilePath $log -Encoding utf8
& 'C:\Program Files\nodejs\node.exe' orchestrator.js @args *>> $log
$code = $LASTEXITCODE
"[$(Get-Date -Format o)] finished, exit code $code" | Out-File -FilePath $log -Append -Encoding utf8
try { [Win32.P]::SetThreadExecutionState([uint32]'0x80000000') | Out-Null } catch { }

# Mark the day done only on success so a failed run retries at the next trigger.
if ($code -eq 0) { $today | Out-File -FilePath $marker -Encoding ascii -NoNewline }
exit $code
