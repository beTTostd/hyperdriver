import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { deleteSession, secureCookie, SESSION_COOKIE } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const cookieStore = await cookies();
  deleteSession(cookieStore.get(SESSION_COOKIE)?.value);
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: secureCookie(),
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}
