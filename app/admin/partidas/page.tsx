import { redirect } from "next/navigation";

export default function LegacyAdminMatchesPage() {
  redirect("/admin/replays");
}
