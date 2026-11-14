import { rmSync, existsSync } from "node:fs";
import { homedir }            from "node:os";
import { join }               from "node:path";

export const dynamic = "force-dynamic";

export async function POST() {
  const somDir = join(homedir(), ".som");
  const files  = [
    "events.db", "events.db-shm", "events.db-wal",
    "klines.db", "klines.db-shm", "klines.db-wal",
  ];

  const removed: string[] = [];
  for (const f of files) {
    const p = join(somDir, f);
    if (existsSync(p)) { rmSync(p); removed.push(f); }
  }

  return Response.json({ removed });
}
