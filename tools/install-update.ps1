# Installs the newest built Claude Manager and restarts it.
#
# Start it detached, with a parent outside the app, so it survives closing the app; this also works
# when the agent that starts it runs inside the app (its turn has time to finish during the delay):
#   Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
#     CommandLine = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Kod\Claude manager\tools\install-update.ps1"' }
# Progress is written to %TEMP%\claude-manager-update.log.
param([int]$DelaySeconds = 20)

$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'claude-manager-update.log'
function Write-Log([string]$text) { "$(Get-Date -Format s) $text" | Add-Content -Path $log -Encoding utf8 }

try {
  $root = Split-Path -Parent $PSScriptRoot
  $installer = Get-ChildItem (Join-Path $root 'dist') -Filter '*Setup*.exe' | Sort-Object LastWriteTime | Select-Object -Last 1
  if (-not $installer) { throw 'Inget installationsprogram i dist; kör npm run dist först.' }
  $installed = Join-Path $env:LOCALAPPDATA 'Programs\Claude Manager'
  Write-Log "väntar $DelaySeconds s, installerar sedan $($installer.Name)"
  Start-Sleep -Seconds $DelaySeconds

  # The app and the Claude processes it started (sessions run claude.exe from the app's folder).
  Get-Process 'Claude Manager' -ErrorAction SilentlyContinue | Stop-Process -Force
  Get-CimInstance Win32_Process -Filter "Name = 'claude.exe'" |
    Where-Object { [string]$_.ExecutablePath -like "$installed*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2

  $run = Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait -PassThru
  Write-Log "installationen klar (kod $($run.ExitCode))"
  Start-Process -FilePath (Join-Path $installed 'Claude Manager.exe')
  Write-Log 'appen startad'
} catch {
  Write-Log "fel: $($_.Exception.Message)"
  exit 1
}
