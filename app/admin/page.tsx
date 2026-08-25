import type { Metadata } from "next";
import { listAdminUsers, requireAdmin } from "../../lib/auth";
import AdminPanel from "./admin-panel";

export const metadata: Metadata = {
  title: "admin",
};

export default async function AdminPage() {
  const currentUser = await requireAdmin();
  const initialUsers = listAdminUsers();
  return <AdminPanel initialUsers={initialUsers} currentUserId={currentUser.id} />;
}
