import type { Metadata } from "next";
import { requireAdmin } from "../../lib/auth";
import { getUploadHealthSummary } from "../../lib/upload-telemetry";
import { getAnalysisQueueSummary } from "../../lib/analysis-queue";
import { collectiveAnalysisConfiguration } from "../../lib/decision-analysis";
import { getBackupStatus } from "../../lib/maintenance";
import HealthPanel from "./health-panel";

export const metadata: Metadata = {
  title: "saúde do sistema",
};

export default async function AdminPage() {
  await requireAdmin();
  return (
    <HealthPanel
      initialSummary={getUploadHealthSummary()}
      initialQueue={getAnalysisQueueSummary()}
      collectiveAnalysis={collectiveAnalysisConfiguration()}
      backupStatus={getBackupStatus()}
    />
  );
}
