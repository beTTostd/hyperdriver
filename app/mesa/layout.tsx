import { requireUser } from "../../lib/auth";

export default async function TableLayout({ children }: { children: React.ReactNode }) {
  await requireUser("/table");
  return children;
}
