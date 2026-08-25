import type { Metadata } from "next";
import { requireAdmin } from "../../lib/auth";
import { getUploadHealthSummary } from "../../lib/upload-telemetry";
import HealthPanel from "./health-panel";

export const metadata: Metadata = {
  title: "saúde do sistema",
};

export default async function AdminPage() {
  await requireAdmin();
  return <HealthPanel initialSummary={getUploadHealthSummary()} />;
}
