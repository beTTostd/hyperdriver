import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db";
import { passwordSetupTokens, sessions, users } from "../db/schema";

export const SESSION_COOKIE = "hyperdriver_session";
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export const PASSWORD_SETUP_DURATION_MS = 2 * 60 * 60 * 1000;

export function secureCookie(): boolean {
  return process.env.NODE_ENV === "production" && process.env.APP_URL?.startsWith("https://") === true;
}

export type UserRole = "admin" | "user";

export type AuthUser = {
  id: number;
  username: string;
  role: UserRole;
  avatarCardId: string | null;
  isActive: boolean;
};

export type AdminUser = AuthUser & {
  hasPassword: boolean;
  lastLoginAt: number | null;
  createdAt: number;
};

export function normalizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidUsername(username: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{1,48}[a-z0-9]$/.test(username);
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length < 12) {
    return "A senha deve ter pelo menos 12 caracteres.";
  }
  if (!/[A-Z]/.test(password)) return "A senha deve ter uma letra maiúscula.";
  if (!/[a-z]/.test(password)) return "A senha deve ter uma letra minúscula.";
  if (!/\d/.test(password)) return "A senha deve ter um número.";
  if (!/[^A-Za-z0-9]/.test(password)) return "A senha deve ter um símbolo.";
  return null;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

export function verifyPassword(password: string, encodedHash: string | null): boolean {
  if (!encodedHash) return false;
  const [algorithm, salt, encodedKey] = encodedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !encodedKey) return false;

  try {
    const expected = Buffer.from(encodedKey, "hex");
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return token ? findUserBySessionToken(token) : null;
}

export function findUserBySessionToken(token: string): AuthUser | null {
  const row = getDb()
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      avatarCardId: users.avatarCardId,
      isActive: users.isActive,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .get();

  if (!row || !row.isActive || row.expiresAt <= Date.now()) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role as UserRole,
    avatarCardId: row.avatarCardId,
    isActive: row.isActive,
  };
}

export async function requireUser(returnTo = "/me"): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (user) return user;
  redirect(loginPath(returnTo));
}

export async function requireAdmin(returnTo = "/admin"): Promise<AuthUser> {
  const user = await requireUser(returnTo);
  if (user.role !== "admin") redirect("/");
  return user;
}

export function loginPath(returnTo = "/me"): string {
  const safeReturnTo = safeRelativePath(returnTo);
  return `/login?returnTo=${encodeURIComponent(safeReturnTo)}`;
}

export function safeRelativePath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://hyperdriver.local");
    if (url.origin !== "https://hyperdriver.local") return "/";
    if (
      url.pathname === "/login" ||
      url.pathname === "/set-password" ||
      url.pathname === "/primeira-senha"
    ) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export function listAdminUsers(): AdminUser[] {
  return getDb()
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      avatarCardId: users.avatarCardId,
      isActive: users.isActive,
      passwordHash: users.passwordHash,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .all()
    .map((row) => ({
      id: row.id,
      username: row.username,
      role: row.role as UserRole,
      avatarCardId: row.avatarCardId,
      isActive: row.isActive,
      hasPassword: Boolean(row.passwordHash),
      lastLoginAt: row.lastLoginAt,
      createdAt: row.createdAt,
    }));
}

export function getPasswordSetupState(token: string) {
  const row = getDb()
    .select({
      username: users.username,
      expiresAt: passwordSetupTokens.expiresAt,
      usedAt: passwordSetupTokens.usedAt,
    })
    .from(passwordSetupTokens)
    .innerJoin(users, eq(users.id, passwordSetupTokens.userId))
    .where(eq(passwordSetupTokens.tokenHash, hashToken(token)))
    .get();

  if (!row || row.usedAt || row.expiresAt <= Date.now()) return null;
  return { username: row.username, expiresAt: row.expiresAt };
}

export function deleteSession(token: string | undefined): void {
  if (!token) return;
  getDb().delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
}

export function createSession(userId: number): string {
  const token = createOpaqueToken();
  const now = Date.now();
  getDb().transaction((database) => {
    database
      .update(users)
      .set({ lastLoginAt: now, updatedAt: now })
      .where(eq(users.id, userId))
      .run();
    database
      .insert(sessions)
      .values({
        userId,
        tokenHash: hashToken(token),
        expiresAt: now + SESSION_DURATION_MS,
      })
      .run();
  });
  return token;
}

export function createPasswordSetup(
  userId: number,
): { token: string; expiresAt: number } {
  const token = createOpaqueToken();
  const expiresAt = Date.now() + PASSWORD_SETUP_DURATION_MS;
  getDb()
    .insert(passwordSetupTokens)
    .values({ userId, tokenHash: hashToken(token), expiresAt })
    .run();
  return { token, expiresAt };
}

export function consumePasswordSetup(token: string, password: string): boolean {
  const database = getDb();
  const now = Date.now();
  const tokenHash = hashToken(token);
  const setup = database
    .select({ id: passwordSetupTokens.id, userId: passwordSetupTokens.userId })
    .from(passwordSetupTokens)
    .where(
      and(
        eq(passwordSetupTokens.tokenHash, tokenHash),
        isNull(passwordSetupTokens.usedAt),
        gt(passwordSetupTokens.expiresAt, now),
      ),
    )
    .get();
  if (!setup) return false;

  const updated = database
    .update(users)
    .set({ passwordHash: hashPassword(password), updatedAt: now })
    .where(eq(users.id, setup.userId))
    .run();
  if (updated.changes !== 1) return false;

  database.delete(sessions).where(eq(sessions.userId, setup.userId)).run();
  database
    .update(passwordSetupTokens)
    .set({ usedAt: now })
    .where(eq(passwordSetupTokens.id, setup.id))
    .run();
  return true;
}

export function appUrl(): string {
  const value = process.env.APP_URL?.trim();
  if (!value) throw new Error("APP_URL must be configured.");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("APP_URL must use http or https.");
  }
  return url.toString().replace(/\/$/, "");
}
