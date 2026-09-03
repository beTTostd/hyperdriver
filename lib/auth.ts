import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, desc, eq, gt, isNull, lt, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db";
import { passwordSetupTokens, sessions, users } from "../db/schema";
import { annotateRequestUser } from "./http";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password-policy";

export const SESSION_COOKIE = "hyperdriver_session";
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export const PASSWORD_SETUP_DURATION_MS = 2 * 60 * 60 * 1000;

export function secureCookie(): boolean {
  return process.env.NODE_ENV === "production";
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
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `A senha deve ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.`;
  }
  if (!/[A-Z]/.test(password)) return "A senha deve ter uma letra maiúscula.";
  if (!/[a-z]/.test(password)) return "A senha deve ter uma letra minúscula.";
  if (!/\d/.test(password)) return "A senha deve ter um número.";
  if (!/[^A-Za-z0-9]/.test(password)) return "A senha deve ter um símbolo.";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await promisify(nodeScrypt)(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, encodedHash: string | null): Promise<boolean> {
  if (!encodedHash) return false;
  const [algorithm, salt, encodedKey] = encodedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !encodedKey) return false;

  try {
    const expected = Buffer.from(encodedKey, "hex");
    const actual = await promisify(nodeScrypt)(password, salt, expected.length) as Buffer;
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
  cleanupExpiredAuthArtifacts();
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
  annotateRequestUser(row.id);
  return {
    id: row.id,
    username: row.username,
    role: row.role as UserRole,
    avatarCardId: row.avatarCardId,
    isActive: row.isActive,
  };
}

export async function requireUser(returnTo = "/replays"): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (user) return user;
  redirect(loginPath(returnTo));
}

export async function requireAdmin(returnTo = "/admin"): Promise<AuthUser> {
  const user = await requireUser(returnTo);
  if (user.role !== "admin") redirect("/");
  return user;
}

export function loginPath(returnTo = "/replays"): string {
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
  annotateRequestUser(userId);
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
  getDb().transaction((database) => {
    database.delete(passwordSetupTokens).where(eq(passwordSetupTokens.userId, userId)).run();
    database
      .insert(passwordSetupTokens)
      .values({ userId, tokenHash: hashToken(token), expiresAt })
      .run();
  });
  return { token, expiresAt };
}

export async function consumePasswordSetup(token: string, password: string): Promise<boolean> {
  const database = getDb();
  const now = Date.now();
  const tokenHash = hashToken(token);
  const passwordHash = await hashPassword(password);
  return database.transaction((transaction) => {
    const setup = transaction
      .select({ id: passwordSetupTokens.id, userId: passwordSetupTokens.userId })
      .from(passwordSetupTokens)
      .where(and(
        eq(passwordSetupTokens.tokenHash, tokenHash),
        isNull(passwordSetupTokens.usedAt),
        gt(passwordSetupTokens.expiresAt, now),
      ))
      .get();
    if (!setup) return false;

    const consumed = transaction
      .update(passwordSetupTokens)
      .set({ usedAt: now })
      .where(and(
        eq(passwordSetupTokens.id, setup.id),
        isNull(passwordSetupTokens.usedAt),
        gt(passwordSetupTokens.expiresAt, now),
      ))
      .run();
    if (consumed.changes !== 1) return false;

    const updated = transaction
      .update(users)
      .set({ passwordHash, updatedAt: now })
      .where(eq(users.id, setup.userId))
      .run();
    if (updated.changes !== 1) return false;

    transaction.delete(sessions).where(eq(sessions.userId, setup.userId)).run();
    transaction
      .delete(passwordSetupTokens)
      .where(and(eq(passwordSetupTokens.userId, setup.userId), ne(passwordSetupTokens.id, setup.id)))
      .run();
    return true;
  });
}

export function appUrl(): string {
  const value = process.env.APP_URL?.trim();
  if (!value) throw new Error("APP_URL must be configured.");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("APP_URL must use http or https.");
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("APP_URL must contain only the application origin.");
  }
  if (
    process.env.NODE_ENV === "production" &&
    url.protocol !== "https:" &&
    url.hostname !== "127.0.0.1" &&
    url.hostname !== "localhost"
  ) {
    throw new Error("APP_URL must use https in production.");
  }
  return url.origin;
}

let lastAuthCleanup = 0;
export function cleanupExpiredAuthArtifacts(now = Date.now()): void {
  if (now - lastAuthCleanup < 5 * 60 * 1000) return;
  lastAuthCleanup = now;
  getDb().transaction((database) => {
    database.delete(sessions).where(lt(sessions.expiresAt, now)).run();
    database.delete(passwordSetupTokens).where(lt(passwordSetupTokens.expiresAt, now)).run();
  });
}
