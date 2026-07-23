import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";

export type MigrationReadiness = {
  status: "ready" | "missing" | "failed" | "unavailable";
  expected: string[];
  applied: string[];
  missing: string[];
  failed: string[];
  unfinished: string[];
};

export async function repositoryMigrationNames(
  migrationsUrl = new URL("../prisma/migrations/", import.meta.url),
): Promise<string[]> {
  const entries = await readdir(fileURLToPath(migrationsUrl), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && /^\d+_[a-z0-9_]+$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export async function checkMigrationReadiness(
  db: Pick<PrismaClient, "$queryRawUnsafe">,
  expected = repositoryMigrationNames(),
): Promise<MigrationReadiness> {
  try {
    const [expectedNames, rows] = await Promise.all([
      expected,
      db.$queryRawUnsafe<Array<{
        migration_name: string;
        finished_at: Date | null;
        rolled_back_at: Date | null;
        logs: string | null;
      }>>(
        'SELECT migration_name, finished_at, rolled_back_at, logs FROM "_prisma_migrations" ORDER BY started_at ASC',
      ),
    ]);
    const activeRows = rows.filter((row) => row.rolled_back_at === null);
    const applied = activeRows.filter((row) => row.finished_at !== null).map((row) => row.migration_name);
    const failed = activeRows
      .filter((row) => row.finished_at === null && Boolean(row.logs))
      .map((row) => row.migration_name);
    const unfinished = activeRows
      .filter((row) => row.finished_at === null && !row.logs)
      .map((row) => row.migration_name);
    const appliedSet = new Set(applied);
    const missing = expectedNames.filter((name) => !appliedSet.has(name));
    const status = failed.length || unfinished.length
      ? "failed"
      : missing.length
        ? "missing"
        : "ready";
    return { status, expected: expectedNames, applied, missing, failed, unfinished };
  } catch {
    return { status: "unavailable", expected: [], applied: [], missing: [], failed: [], unfinished: [] };
  }
}
