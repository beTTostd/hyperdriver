import { redirect } from "next/navigation";

export default async function FirstPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token || "";
  redirect(token ? `/set-password?token=${encodeURIComponent(token)}` : "/set-password");
}
