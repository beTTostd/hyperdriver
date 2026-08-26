import TalisharTable from "./replay-table";
import { requireUser } from "../../lib/auth";
import { decisionAnalysisVisibleTo } from "../../lib/decision-analysis";

export default async function TablePage() {
  const currentUser = await requireUser("/table");
  return <TalisharTable decisionAnalysisEnabled={decisionAnalysisVisibleTo(currentUser.role)} />;
}
