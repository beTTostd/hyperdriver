import type { Metadata } from "next";
import { listAdminUsers, requireAdmin } from "../../../lib/auth";
import AdminPanel from "../admin-panel";

export const metadata: Metadata = {
  title: "usuários",
};

export default async function AdminUsersPage() {
  const currentUser = await requireAdmin("/admin/usuarios");
  return <AdminPanel initialUsers={listAdminUsers()} currentUserId={currentUser.id} />;
}
