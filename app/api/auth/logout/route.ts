import { cookies } from "next/headers";
import { deleteSession, secureCookie, SESSION_COOKIE } from "../../../../lib/auth";
import { originError, privateJson, validateMutationOrigin, withApiLogging } from "../../../../lib/http";

export const runtime = "nodejs";

async function logout(request: Request) {
  if (!validateMutationOrigin(request)) return originError();
  const cookieStore = await cookies();
  deleteSession(cookieStore.get(SESSION_COOKIE)?.value);
  const response = privateJson({ ok: true });
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

export const POST = withApiLogging("/api/auth/logout", logout);
