#!/usr/bin/env node
/**
 * ==============================================================================
 * RTARTS System - Universal Smart Database Backup Engine
 * Cross-platform: Runs on Windows, Linux, macOS, and Docker environments.
 * ==============================================================================
 *
 * Smart Storage Location Resolution:
 * 1. BACKUP_DIR environment variable (if defined)
 * 2. Secondary physical drive D:\BACKUP\RTARTS_DB (if Windows and D: exists)
 * 3. Default portable project directory: <project_root>/backups
 */

import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// Configuration
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || "30", 10);

/**
 * Smartly resolve the best available backup directory
 */
export function resolveBackupDir() {
  // 1. Explicit environment variable
  if (process.env.BACKUP_DIR && process.env.BACKUP_DIR.trim()) {
    const customDir = path.resolve(process.env.BACKUP_DIR.trim());
    try {
      fs.mkdirSync(customDir, { recursive: true });
      return { dir: customDir, reason: "Configured via BACKUP_DIR environment variable" };
    } catch (e) {
      console.warn(`[WARN] Custom BACKUP_DIR '${customDir}' could not be created: ${e.message}`);
    }
  }

  // 2. Windows secondary D:\ drive check
  if (process.platform === "win32") {
    const dDrivePath = "D:\\BACKUP\\RTARTS_DB";
    try {
      if (fs.existsSync("D:\\")) {
        fs.mkdirSync(dDrivePath, { recursive: true });
        return { dir: dDrivePath, reason: "Dedicated secondary physical drive (D:\\)" };
      }
    } catch {
      // D: drive not available or no write permission, fall through
    }
  }

  // 3. Fallback: Portable project backups folder
  const projectBackupDir = path.join(projectRoot, "backups");
  try {
    fs.mkdirSync(projectBackupDir, { recursive: true });
    return { dir: projectBackupDir, reason: "Portable server project storage (./backups)" };
  } catch (e) {
    // 4. Last resort: user home directory
    const homeBackupDir = path.join(os.homedir(), "rtarts_backups");
    fs.mkdirSync(homeBackupDir, { recursive: true });
    return { dir: homeBackupDir, reason: "User home directory storage (~/rtarts_backups)" };
  }
}

/**
 * Detect the active Supabase PostgreSQL container
 */
function findSupabaseContainer() {
  if (process.env.SUPABASE_CONTAINER) {
    return process.env.SUPABASE_CONTAINER.trim();
  }
  try {
    const output = execSync(
      'docker ps --filter "name=supabase_db_" --filter "status=running" --format "{{.Names}}"',
      { encoding: "utf8" }
    ).trim();
    if (!output) return null;
    return output.split("\n")[0].trim();
  } catch (err) {
    return null;
  }
}

/**
 * Format bytes into human-readable size
 */
function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

async function main() {
  console.log("\n========================================================");
  console.log("  RTARTS System - Smart Cross-Platform Database Backup   ");
  console.log("========================================================\n");

  // Step 1: Detect Container
  console.log("[1/5] Finding active Supabase database container...");
  const containerId = findSupabaseContainer();
  if (!containerId) {
    console.error("[ERROR] No active Supabase Postgres container found via Docker.");
    console.error("        Ensure the database is running (e.g. 'npx supabase start').");
    process.exit(1);
  }
  console.log(`  ✓ Container found: ${containerId}`);

  // Step 2: Resolve Backup Directory
  console.log("[2/5] Resolving adaptive backup directory...");
  const { dir: backupDir, reason } = resolveBackupDir();
  console.log(`  ✓ Target storage: ${backupDir}`);
  console.log(`    Mode: ${reason}`);

  // Step 3: Run pg_dump inside container
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "_")
    .split(".")[0];
  const sqlFileName = `rtarts_backup_${timestamp}.sql`;
  const containerTmpSql = `/tmp/${sqlFileName}`;
  const hostSqlPath = path.join(backupDir, sqlFileName);

  console.log("[3/5] Exporting database schemas (public, auth, storage)...");
  try {
    execSync(
      `docker exec ${containerId} pg_dump -U supabase_admin -d postgres --clean --if-exists --schema=public --schema=auth --schema=storage -f ${containerTmpSql}`,
      { stdio: "inherit" }
    );

    // Copy out from container
    execSync(`docker cp "${containerId}:${containerTmpSql}" "${hostSqlPath}"`);
    execSync(`docker exec ${containerId} rm -f ${containerTmpSql}`);

    const rawStat = fs.statSync(hostSqlPath);
    console.log(`  ✓ Raw SQL dump created: ${hostSqlPath} (${formatBytes(rawStat.size)})`);
  } catch (err) {
    console.error(`[ERROR] Database export failed: ${err.message}`);
    process.exit(1);
  }

  // Step 4: Compress with Gzip
  console.log("[4/5] Compressing SQL dump...");
  const gzFileName = `${sqlFileName}.gz`;
  const gzFilePath = path.join(backupDir, gzFileName);

  try {
    const readStream = fs.createReadStream(hostSqlPath);
    const writeStream = fs.createWriteStream(gzFilePath);
    const gzipStream = zlib.createGzip({ level: 9 });

    await pipeline(readStream, gzipStream, writeStream);
    fs.unlinkSync(hostSqlPath); // Remove raw uncompressed SQL

    const gzStat = fs.statSync(gzFilePath);
    console.log(`  ✓ Compressed archive created: ${gzFilePath} (${formatBytes(gzStat.size)})`);
  } catch (err) {
    console.warn(`  [WARN] Compression failed (${err.message}); retaining uncompressed SQL.`);
  }

  // Step 5: Clean up old backups according to retention policy
  console.log(`[5/5] Enforcing retention policy (older than ${RETENTION_DAYS} days)...`);
  try {
    const files = fs.readdirSync(backupDir);
    const cutoffTime = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    for (const file of files) {
      if (file.startsWith("rtarts_backup_") && (file.endsWith(".gz") || file.endsWith(".zip") || file.endsWith(".sql"))) {
        const filePath = path.join(backupDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoffTime) {
          fs.unlinkSync(filePath);
          console.log(`  - Cleaned up expired backup: ${file}`);
          deletedCount++;
        }
      }
    }
    if (deletedCount === 0) {
      console.log("  ✓ No expired backups found.");
    }
  } catch (err) {
    console.warn(`  [WARN] Retention check failed: ${err.message}`);
  }

  console.log("\n========================================================");
  console.log("  Backup Completed Successfully!                          ");
  console.log(`  Saved to: ${backupDir}`);
  console.log("========================================================\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("[FATAL]", err);
    process.exit(1);
  });
}
