#!/usr/bin/env node
/**
 * ==============================================================================
 * RTARTS System - Universal Smart Database Restore Engine
 * Cross-platform: Runs on Windows, Linux, macOS, and Docker environments.
 * ==============================================================================
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import readline from "node:readline";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { resolveBackupDir } from "./backup-db.mjs";

const __filename = fileURLToPath(import.meta.url);

function findSupabaseContainer() {
  if (process.env.SUPABASE_CONTAINER) {
    return process.env.SUPABASE_CONTAINER.trim();
  }
  try {
    const output = execSync(
      'docker ps --filter "name=supabase_db_" --filter "status=running" --format "{{.Names}}"',
      { encoding: "utf8" },
    ).trim();
    if (!output) return null;
    return output.split("\n")[0].trim();
  } catch {
    return null;
  }
}

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function decompressGzip(sourceGz, destSql) {
  const readStream = fs.createReadStream(sourceGz);
  const writeStream = fs.createWriteStream(destSql);
  const gunzip = zlib.createGunzip();
  await pipeline(readStream, gunzip, writeStream);
}

async function main() {
  console.log("\n========================================================");
  console.log("  RTARTS System - Smart Database Restore Engine          ");
  console.log("========================================================\n");

  const args = process.argv.slice(2);
  const forceFlag = args.includes("--force") || args.includes("-f");
  let targetFile = args.find((a) => !a.startsWith("-"));

  // Step 1: Detect Container
  console.log("[1/5] Finding active Supabase database container...");
  const containerId = findSupabaseContainer();
  if (!containerId) {
    console.error("[ERROR] No active Supabase Postgres container found via Docker.");
    process.exit(1);
  }
  console.log(`  ✓ Container found: ${containerId}`);

  // Step 2: Resolve Target File
  console.log("[2/5] Locating backup file...");
  const { dir: backupDir } = resolveBackupDir();

  if (!targetFile) {
    if (!fs.existsSync(backupDir)) {
      console.error(`[ERROR] Backup directory not found: ${backupDir}`);
      process.exit(1);
    }

    const files = fs
      .readdirSync(backupDir)
      .filter(
        (f) =>
          f.startsWith("rtarts_backup_") &&
          (f.endsWith(".gz") || f.endsWith(".zip") || f.endsWith(".sql")),
      )
      .map((f) => {
        const fullPath = path.join(backupDir, f);
        return { name: f, fullPath, mtime: fs.statSync(fullPath).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
      console.error(`[ERROR] No backup archives found in: ${backupDir}`);
      process.exit(1);
    }

    targetFile = files[0].fullPath;
    console.log(`  ✓ Auto-selected latest backup: ${files[0].name}`);
  } else {
    targetFile = path.resolve(targetFile);
    if (!fs.existsSync(targetFile)) {
      console.error(`[ERROR] Specified backup file does not exist: ${targetFile}`);
      process.exit(1);
    }
    console.log(`  ✓ Target backup file: ${targetFile}`);
  }

  // Step 3: Safety Confirmation
  if (!forceFlag) {
    console.log(
      "\n⚠️  WARNING: Restoring will overwrite existing database records with the backup state.",
    );
    const answer = await prompt("Are you sure you want to proceed? (Type 'YES' to confirm): ");
    if (answer !== "YES") {
      console.log("Restore operation aborted by user.");
      process.exit(0);
    }
  }

  // Step 4: Decompress if necessary
  console.log("\n[3/5] Preparing SQL payload...");
  let sqlToRestore = targetFile;
  let tempSqlFile = null;

  if (targetFile.endsWith(".gz")) {
    tempSqlFile = path.join(os.tmpdir(), `rtarts_restore_${Date.now()}.sql`);
    console.log(`  Decompressing GZIP archive to temporary file...`);
    await decompressGzip(targetFile, tempSqlFile);
    sqlToRestore = tempSqlFile;
  } else if (targetFile.endsWith(".zip")) {
    console.log(`  Decompressing ZIP archive...`);
    // If ZIP on Windows, powershell can extract, or node unzipper if present
    tempSqlFile = path.join(os.tmpdir(), `rtarts_restore_${Date.now()}.sql`);
    if (process.platform === "win32") {
      const tempExtractDir = path.join(os.tmpdir(), `rtarts_extract_${Date.now()}`);
      fs.mkdirSync(tempExtractDir, { recursive: true });
      execSync(
        `powershell -Command "Expand-Archive -Path '${targetFile}' -DestinationPath '${tempExtractDir}' -Force"`,
      );
      const extractedFiles = fs.readdirSync(tempExtractDir).filter((f) => f.endsWith(".sql"));
      if (extractedFiles.length === 0) {
        throw new Error("No .sql file found inside ZIP archive");
      }
      sqlToRestore = path.join(tempExtractDir, extractedFiles[0]);
    } else {
      execSync(`unzip -p "${targetFile}" > "${tempSqlFile}"`);
      sqlToRestore = tempSqlFile;
    }
  }

  // Step 5: Restore to Postgres Container
  console.log("[4/5] Restoring database into Postgres container...");
  const containerTmpSql = "/tmp/rtarts_restore.sql";
  try {
    execSync(`docker cp "${sqlToRestore}" "${containerId}:${containerTmpSql}"`);
    execSync(
      `docker exec ${containerId} psql -U supabase_admin -d postgres -f ${containerTmpSql}`,
      {
        stdio: "pipe",
      },
    );
    execSync(`docker exec ${containerId} rm -f ${containerTmpSql}`);
    console.log("  ✓ Database dump applied successfully.");
  } catch (err) {
    console.error(`[ERROR] Database restore execution failed: ${err.message}`);
    process.exit(1);
  } finally {
    if (tempSqlFile && fs.existsSync(tempSqlFile)) {
      try {
        fs.unlinkSync(tempSqlFile);
      } catch {}
    }
  }

  // Step 6: Post-restore role grants
  console.log("[5/5] Re-applying API role permissions on schema public...");
  try {
    const grantSql = `
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, authenticator;
      GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, authenticator;
      GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, authenticator;
      GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role, authenticator;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role, authenticator;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role, authenticator;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role, authenticator;
    `;
    execSync(
      `docker exec ${containerId} psql -U supabase_admin -d postgres -c "${grantSql.replace(/\n/g, " ")}"`,
      {
        stdio: "pipe",
      },
    );
    console.log("  ✓ Permissions verified and restored.");
  } catch (err) {
    console.warn(`  [WARN] Grant permissions encountered a notice: ${err.message}`);
  }

  console.log("\n========================================================");
  console.log("  Database Restored Successfully!                        ");
  console.log("========================================================\n");
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
