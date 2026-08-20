import { redirect } from "next/navigation";

export default function LegacyEditProfilePage() {
  redirect("/me/profile");
}
