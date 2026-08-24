import TalisharTable from "./replay-table";
import { requireUser } from "../../lib/auth";

export default async function TablePage() {
  await requireUser("/table");
  return <TalisharTable />;
}
