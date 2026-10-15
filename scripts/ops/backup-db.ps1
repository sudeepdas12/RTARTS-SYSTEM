# ==============================================================================
# RTARTS System - Adaptive Database Backup Script
# Automatically adapts to available server drives (D:\, custom BACKUP_DIR, or ./backups)
# ==============================================================================

[CmdletBinding()]
param (
    [string]$BackupDir = "",
    [int]$RetentionDays = 30,
    [switch]$Compress = $true
)

$ErrorActionPreference = "Stop"

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host " RTARTS System - Adaptive Database Backup" -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# 1. Locate the running Supabase Postgres container
Write-Host "[1/5] Finding active Supabase database container..." -ForegroundColor Yellow
$containerId = (docker ps --filter "name=supabase_db_" --filter "status=running" --format "{{.Names}}" | Select-Object -First 1)

if (-not $containerId) {
    Write-Host "[ERROR] No active Supabase Postgres container found!" -ForegroundColor Red
    Write-Host "Please start the database first by running: npx supabase start" -ForegroundColor Red
    exit 1
}

Write-Host "  -> Found running container: $containerId" -ForegroundColor Green

# 2. Smart target directory resolution
Write-Host "[2/5] Resolving adaptive backup storage location..." -ForegroundColor Yellow

$targetDir = $BackupDir
if ([string]::IsNullOrWhiteSpace($targetDir)) {
    if ($env:BACKUP_DIR) {
        $targetDir = $env:BACKUP_DIR
    } elseif (Test-Path -Path "D:\") {
        $targetDir = "D:\BACKUP\RTARTS_DB"
    } else {
        # Fallback to local project backups directory
        $targetDir = Join-Path $PSScriptRoot "..\..\backups"
    }
}

try {
    if (-not (Test-Path -Path $targetDir)) {
        New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
    }
    $resolvedPath = (Resolve-Path -Path $targetDir).Path
    Write-Host "  -> Active backup directory: $resolvedPath" -ForegroundColor Green
    $BackupDir = $resolvedPath
} catch {
    # If chosen path fails, last resort fallback to user home directory
    $targetDir = Join-Path $env:USERPROFILE "rtarts_backups"
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
    $resolvedPath = (Resolve-Path -Path $targetDir).Path
    Write-Host "  -> Fallback to home directory: $resolvedPath" -ForegroundColor Yellow
    $BackupDir = $resolvedPath
}

# 3. Dump database schemas (public, auth, storage) inside the container
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$sqlFileName = "rtarts_backup_$timestamp.sql"
$containerTmpPath = "/tmp/$sqlFileName"
$hostSqlPath = Join-Path $BackupDir $sqlFileName

Write-Host "[3/5] Exporting database tables and auth records..." -ForegroundColor Yellow
try {
    # Run pg_dump directly inside the Linux container as superuser for 100% fidelity
    docker exec $containerId pg_dump -U supabase_admin -d postgres `
        --clean --if-exists `
        --schema=public --schema=auth --schema=storage `
        -f $containerTmpPath

    if ($LASTEXITCODE -ne 0) {
        throw "pg_dump failed inside container with exit code $LASTEXITCODE"
    }

    # Copy the generated dump from container to Windows D: drive
    docker cp "$($containerId):$containerTmpPath" $hostSqlPath
    docker exec $containerId rm -f $containerTmpPath

    $sqlItem = Get-Item $hostSqlPath
    $sizeMB = [math]::Round($sqlItem.Length / 1MB, 2)
    Write-Host "  -> SQL dump created: $hostSqlPath ($sizeMB MB)" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Database dump failed: $_" -ForegroundColor Red
    exit 1
}

# 4. Optional Compression (.zip)
$finalPath = $hostSqlPath
if ($Compress) {
    Write-Host "[4/5] Compressing SQL dump to ZIP archive..." -ForegroundColor Yellow
    $zipFileName = "rtarts_backup_$timestamp.zip"
    $zipPath = Join-Path $BackupDir $zipFileName
    try {
        Compress-Archive -Path $hostSqlPath -DestinationPath $zipPath -Force
        Remove-Item -Path $hostSqlPath -Force
        $zipItem = Get-Item $zipPath
        $zipSizeMB = [math]::Round($zipItem.Length / 1MB, 2)
        $finalPath = $zipPath
        Write-Host "  -> Compressed archive created: $zipPath ($zipSizeMB MB)" -ForegroundColor Green
    } catch {
        Write-Host "  -> Warning: Compression failed ($_); keeping raw SQL file." -ForegroundColor Yellow
    }
} else {
    Write-Host "[4/5] Skipping compression (raw SQL dump kept)." -ForegroundColor Gray
}

# 5. Cleanup older backups according to retention policy
Write-Host "[5/5] Checking retention policy (Keep last $RetentionDays days)..." -ForegroundColor Yellow
$cutoffDate = (Get-Date).AddDays(-$RetentionDays)
$oldFiles = Get-ChildItem -Path $BackupDir -File -Filter "rtarts_backup_*" | Where-Object { $_.LastWriteTime -lt $cutoffDate }

if ($oldFiles) {
    foreach ($oldFile in $oldFiles) {
        Remove-Item -Path $oldFile.FullName -Force
        Write-Host "  -> Removed expired backup: $($oldFile.Name)" -ForegroundColor Gray
    }
} else {
    Write-Host "  -> No expired backups to prune." -ForegroundColor Green
}

$allBackups = Get-ChildItem -Path $BackupDir -File -Filter "rtarts_backup_*"
Write-Host "`n========================================================" -ForegroundColor Green
Write-Host " BACKUP SUCCESSFUL!" -ForegroundColor Green
Write-Host " Saved to: $finalPath" -ForegroundColor Green
Write-Host " Total active backups in $BackupDir : $($allBackups.Count)" -ForegroundColor Green
Write-Host "========================================================`n" -ForegroundColor Green
