# ==============================================================================
# RTARTS System - Adaptive Database Restore Script
# Automatically adapts to available server drives (D:\, custom BACKUP_DIR, or ./backups)
# ==============================================================================

[CmdletBinding()]
param (
    [string]$BackupFile = "",
    [string]$BackupDir = "",
    [switch]$Force = $false
)

$ErrorActionPreference = "Stop"

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host " RTARTS System - Adaptive Database Restore" -ForegroundColor Cyan
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

# 2. Identify the backup file to restore
Write-Host "[2/5] Selecting backup file..." -ForegroundColor Yellow
$targetBackup = $BackupFile

if ([string]::IsNullOrWhiteSpace($targetBackup)) {
    $targetDir = $BackupDir
    if ([string]::IsNullOrWhiteSpace($targetDir)) {
        if ($env:BACKUP_DIR) {
            $targetDir = $env:BACKUP_DIR
        } elseif (Test-Path -Path "D:\BACKUP\RTARTS_DB") {
            $targetDir = "D:\BACKUP\RTARTS_DB"
        } elseif (Test-Path -Path "D:\") {
            $targetDir = "D:\BACKUP\RTARTS_DB"
        } else {
            $targetDir = Join-Path $PSScriptRoot "..\..\backups"
        }
    }

    if (-not (Test-Path -Path $targetDir)) {
        Write-Host "[ERROR] Backup directory not found: $targetDir" -ForegroundColor Red
        exit 1
    }

    $latestBackup = Get-ChildItem -Path $targetDir -File -Filter "rtarts_backup_*" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latestBackup) {
        Write-Host "[ERROR] No backup files found in $targetDir" -ForegroundColor Red
        exit 1
    }
    $targetBackup = $latestBackup.FullName
    Write-Host "  -> Auto-selected latest backup: $($latestBackup.Name) ($( [math]::Round($latestBackup.Length / 1MB, 2) ) MB, $($latestBackup.LastWriteTime))" -ForegroundColor Green
} else {
    if (-not (Test-Path -Path $targetBackup)) {
        Write-Host "[ERROR] Specified backup file does not exist: $targetBackup" -ForegroundColor Red
        exit 1
    }
    Write-Host "  -> Using specified backup file: $targetBackup" -ForegroundColor Green
}

# 3. Confirmation prompt
if (-not $Force) {
    Write-Host "`n[WARNING] Restoring will overwrite existing data with data from the backup." -ForegroundColor Yellow
    $confirmation = Read-Host "Are you sure you want to proceed? (Type 'YES' to continue)"
    if ($confirmation -ne "YES") {
        Write-Host "Restore operation aborted by user." -ForegroundColor Gray
        exit 0
    }
}

# 4. Handle ZIP extraction if needed
$tempSqlDir = $null
$sqlFileToRestore = $targetBackup

if ($targetBackup.EndsWith(".zip", [System.StringComparison]::OrdinalIgnoreCase)) {
    Write-Host "[3/5] Extracting ZIP backup archive..." -ForegroundColor Yellow
    $tempSqlDir = Join-Path $env:TEMP ("rtarts_restore_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
    New-Item -ItemType Directory -Path $tempSqlDir -Force | Out-Null
    Expand-Archive -Path $targetBackup -DestinationPath $tempSqlDir -Force
    $extractedSql = Get-ChildItem -Path $tempSqlDir -Filter "*.sql" | Select-Object -First 1
    if (-not $extractedSql) {
        Write-Host "[ERROR] No .sql file found inside $targetBackup" -ForegroundColor Red
        Remove-Item -Path $tempSqlDir -Recurse -Force
        exit 1
    }
    $sqlFileToRestore = $extractedSql.FullName
    Write-Host "  -> Extracted: $($extractedSql.Name)" -ForegroundColor Green
} else {
    Write-Host "[3/5] Backup is already an uncompressed SQL file." -ForegroundColor Gray
}

# 5. Restore database via container psql
Write-Host "[4/5] Restoring database into Postgres container..." -ForegroundColor Yellow
$containerTmpPath = "/tmp/rtarts_restore.sql"

try {
    docker cp $sqlFileToRestore "$($containerId):$containerTmpPath"
    
    # Run psql import as supabase_admin to ensure all auth and storage permissions restore cleanly
    docker exec $containerId psql -U supabase_admin -d postgres -f $containerTmpPath | Out-Null

    # Re-apply Supabase API role permissions on schema public
    $grantSql = @"
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, authenticator;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, authenticator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, authenticator;
GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role, authenticator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role, authenticator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role, authenticator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role, authenticator;
NOTIFY pgrst, 'reload schema';
"@
    docker exec $containerId psql -U postgres -d postgres -c $grantSql | Out-Null

    # Reload PostgREST container schema cache
    $restContainer = (docker ps --filter "name=supabase_rest_" --filter "status=running" --format "{{.Names}}" | Select-Object -First 1)
    if ($restContainer) {
        docker restart $restContainer | Out-Null
    }

    docker exec $containerId rm -f $containerTmpPath
    Write-Host "  -> SQL restore and schema permissions applied." -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Restore execution failed: $_" -ForegroundColor Red
    if ($tempSqlDir -and (Test-Path $tempSqlDir)) { Remove-Item -Path $tempSqlDir -Recurse -Force }
    exit 1
} finally {
    if ($tempSqlDir -and (Test-Path $tempSqlDir)) {
        Remove-Item -Path $tempSqlDir -Recurse -Force
    }
}

# 6. Verify table counts
Write-Host "[5/5] Verifying restored tables..." -ForegroundColor Yellow
try {
    $verifyQuery = "SELECT 'companies' AS tbl, count(*) FROM public.companies UNION ALL SELECT 'clients', count(*) FROM public.clients UNION ALL SELECT 'dividend_payables', count(*) FROM public.dividend_payables UNION ALL SELECT 'auth.users', count(*) FROM auth.users;"
    $verifyOutput = docker exec $containerId psql -U postgres -d postgres -t -A -c $verifyQuery
    Write-Host "`n  Current Record Counts:" -ForegroundColor Cyan
    foreach ($line in $verifyOutput) {
        if ($line) {
            $parts = $line.Split("|")
            Write-Host "    - $($parts[0]): $($parts[1]) records" -ForegroundColor White
        }
    }
} catch {
    Write-Host "  -> Warning: Could not run post-restore verification query: $_" -ForegroundColor Yellow
}

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host " RESTORE COMPLETED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "========================================================`n" -ForegroundColor Green
