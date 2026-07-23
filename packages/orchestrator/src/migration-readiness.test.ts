import { describe, expect, it, vi } from "vitest";
import { checkMigrationReadiness } from "./migration-readiness.js";

const expected = Promise.resolve(["001_initial", "002_runtime"]);
const row = (migration_name: string, overrides: Partial<{ finished_at: Date | null; rolled_back_at: Date | null; logs: string | null }> = {}) => ({
  migration_name,
  finished_at: new Date(),
  rolled_back_at: null,
  logs: null,
  ...overrides,
});

describe("migration readiness", () => {
  it("is ready when every repository migration is applied", async () => {
    const db = { $queryRawUnsafe: vi.fn(async () => [row("001_initial"), row("002_runtime")]) };
    expect(await checkMigrationReadiness(db as never, expected)).toMatchObject({ status: "ready", missing: [], failed: [], unfinished: [] });
  });

  it("reports a missing migration without depending on a historical hard-coded name", async () => {
    const db = { $queryRawUnsafe: vi.fn(async () => [row("001_initial")]) };
    expect(await checkMigrationReadiness(db as never, expected)).toMatchObject({ status: "missing", missing: ["002_runtime"] });
  });

  it("reports failed and unfinished Prisma migrations", async () => {
    const failedDb = { $queryRawUnsafe: vi.fn(async () => [row("001_initial"), row("002_runtime", { finished_at: null, logs: "database error" })]) };
    expect(await checkMigrationReadiness(failedDb as never, expected)).toMatchObject({ status: "failed", failed: ["002_runtime"] });
    const unfinishedDb = { $queryRawUnsafe: vi.fn(async () => [row("001_initial"), row("002_runtime", { finished_at: null })]) };
    expect(await checkMigrationReadiness(unfinishedDb as never, expected)).toMatchObject({ status: "failed", unfinished: ["002_runtime"] });
  });
});
