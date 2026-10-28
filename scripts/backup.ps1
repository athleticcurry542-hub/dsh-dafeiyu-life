<#
.SYNOPSIS
  One-shot backup of the dafeiyu-life runtime data directory.

.DESCRIPTION
  Packages the runtime data dir (default %DSH_HOME%\bili-duty, or ~\.dsh\bili-duty)
  into a timestamped zip, preserving SQLite db / -wal / -shm (recursive pack includes them).
  Excludes Bilibili credentials and regenerable caches by default.
  Prunes old backups, keeping the most recent N.

.PARAMETER DataDir
  Runtime data directory. Defaults to %DSH_HOME%\bili-duty or ~\.dsh\bili-duty.

.PARAMETER BackupDir
  Where to store backups. Defaults to <DataDir-parent>\dafeiyu-backups.

.PARAMETER Keep
  Number of recent backups to keep. Default 14.

.PARAMETER IncludeCredentials
  Explicitly include bili_credential.json (Bilibili cookie/credential). Excluded by default.

.EXAMPLE
  .\scripts\backup.ps1
  .\scripts\backup.ps1 -DataDir "$env:USERPROFILE\.dsh\bili-duty" -Keep 30
#>
param(
  [string]$DataDir = "",
  [string]$BackupDir = "",
  [int]$Keep = 14,
  [switch]$IncludeCredentials
)

$ErrorActionPreference = 'Stop'

# ---------- 1. Resolve data directory ----------
if (-not $DataDir) {
  if ($env:DSH_HOME) { $DataDir = Join-Path $env:DSH_HOME 'bili-duty' }
  else { $DataDir = Join-Path $HOME '.dsh\bili-duty' }
}
if (-not (Test-Path -LiteralPath $DataDir -PathType Container)) {
  Write-Error "Data dir not found: $DataDir (DSH may not be installed, or plugin never ran)"
}

# ---------- 2. Resolve backup directory ----------
if (-not $BackupDir) {
  $BackupDir = Join-Path (Split-Path $DataDir -Parent) 'dafeiyu-backups'
}
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

# ---------- 3. Timestamp and staging dir ----------
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$zipPath = Join-Path $BackupDir "dafeiyu-life-$stamp.zip"
$staging = Join-Path ([System.IO.Path]::GetTempPath()) ("dafeiyu-staging-" + [guid]::NewGuid().ToString('N'))

# ---------- 4. Exclusions ----------
$excludeFiles = @('bili_credential.json', 'uid-cache.json', '*.tmp', '*.new', '*.pyc', '*.sha', '.write.lock')
$excludeDirs  = @('__pycache__', '.venv', 'venv', 'model_cache', '.cache', 'python-env')
if ($IncludeCredentials) {
  $excludeFiles = @($excludeFiles | Where-Object { $_ -ne 'bili_credential.json' })
}

# ---------- 5. Stage a copy (robocopy tolerates transient file locks) ----------
try {
  $roboArgs = @($DataDir, $staging, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1')
  $roboArgs += $excludeDirs | ForEach-Object { @('/XD', $_) }
  $roboArgs += $excludeFiles | ForEach-Object { @('/XF', $_) }
  & robocopy @roboArgs | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit code $LASTEXITCODE)" }

  # ---------- 6. Compress ----------
  Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipPath -Force

  # ---------- 7. Prune old backups ----------
  $all = Get-ChildItem -LiteralPath $BackupDir -Filter 'dafeiyu-life-*.zip' -ErrorAction SilentlyContinue |
         Sort-Object LastWriteTime -Descending
  $old = $all | Select-Object -Skip $Keep
  foreach ($o in $old) {
    Remove-Item -LiteralPath $o.FullName -Force
    Write-Host "Removed old backup: $($o.Name)"
  }

  Write-Host "Backup done: $zipPath"
  Write-Host ("Keeping {0} backup(s) including this one" -f [math]::Min($all.Count, $Keep))
}
finally {
  if (Test-Path -LiteralPath $staging) { Remove-Item -Recurse -Force -LiteralPath $staging }
}
