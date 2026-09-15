import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { maintenanceState } from "../db/schema";

export type BackupStatus = {
  completedAt: number | null;
  replayCount: number | null;
  verifiedAt: number | null;
};

export function getBackupStatus(): BackupStatus {
  const row = getDb().select().from(maintenanceState).where(eq(maintenanceState.key, "last_successful_backup")).get();
  if (!row) return { completedAt: null, replayCount: null, verifiedAt: null };
  try {
    const value = JSON.parse(row.value);
    return {
      completedAt: row.updatedAt,
      replayCount: Number.isSafeInteger(value?.replayCount) ? value.replayCount : null,
      verifiedAt: Number.isSafeInteger(value?.verifiedAt) ? value.verifiedAt : null,
    };
  } catch {
    return { completedAt: row.updatedAt, replayCount: null, verifiedAt: null };
  }
}
