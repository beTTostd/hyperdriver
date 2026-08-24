import TalisharTable from "../mesa/page";
import { requireUser } from "../../lib/auth";

export default async function TablePage() {
  await requireUser("/table");
  return <TalisharTable />;
}
