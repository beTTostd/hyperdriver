import { NextResponse } from "next/server";
import { consumePasswordSetup, validatePassword } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await readBody(request);
  const token = typeof body?.token === "string" ? body.token : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const confirmation = typeof body?.confirmation === "string" ? body.confirmation : "";
  const passwordError = validatePassword(password);

  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });
  if (password !== confirmation) {
    return NextResponse.json({ error: "As senhas não coincidem." }, { status: 400 });
  }
  if (!token || !consumePasswordSetup(token, password)) {
    return NextResponse.json(
      { error: "Este link é inválido, expirou ou já foi utilizado." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
