import { and, count, desc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "../db";
import { uploadEvents, users } from "../db/schema";
import type { ReplayDocument } from "./replays";

export const UPLOAD_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const UPLOAD_HEALTH_DAYS = 7;
export const UPLOAD_EVENT_PAGE_SIZE = 25;
export const UPLOAD_EVENT_MAX_MESSAGE_LENGTH = 240;
export const UPLOAD_HEALTH_TIME_ZONE = "America/Sao_Paulo";

export const UPLOAD_EVENT_CATEGORIES = [
  "success",
  "error",
  "duplicate",
  "non_t0",
  "corrupt",
] as const;

export type UploadEventCategory = typeof UPLOAD_EVENT_CATEGORIES[number];

export const UPLOAD_EVENT_CATEGORY_LABELS: Record<UploadEventCategory, string> = {
  success: "Partidas aceitas",
  error: "Uploads com erro",
  duplicate: "Arquivos duplicados",
  non_t0: "Não começou no T0",
  corrupt: "Arquivos corrompidos",
};

export type UploadEventInput = {
  userId: number;
  attemptedAt?: number;
  sourceMatchId?: string | null;
  category: UploadEventCategory;
  httpStatus: number;
  errorCode?: string | null;
  technicalMessage?: string | null;
  replayId?: number | null;
};

export type UploadHealthDay = {
  date: string;
  label: string;
  total: number;
  cells: Record<UploadEventCategory, { count: number; percentage: number }>;
};

export type UploadHealthSummary = {
  generatedAt: number;
  timeZone: string;
  window: {
    from: string;
    to: string;
    label: string;
  };
  total: number;
  categories: Array<{
    key: UploadEventCategory;
    label: string;
    total: number;
  }>;
  days: UploadHealthDay[];
};

export type UploadEventDetail = {
  id: number;
  attemptedAt: number;
  username: string;
  sourceMatchId: string | null;
  category: UploadEventCategory;
  httpStatus: number;
  errorCode: string | null;
  technicalMessage: string | null;
  replayId: number | null;
};

export type UploadEventPage = {
  items: UploadEventDetail[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

type CalendarParts = { year: number; month: number; day: number };

const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: UPLOAD_HEALTH_TIME_ZONE,
});

function parseDateParts(timestamp: number): CalendarParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: UPLOAD_HEALTH_TIME_ZONE,
  }).formatToParts(new Date(timestamp));
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
}

function dateKey(parts: CalendarParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function addCalendarDays(parts: CalendarParts, amount: number): CalendarParts {
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function localMidnight(parts: CalendarParts): number {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day);
  let candidate = target;
  // Adjust the UTC representation until its São Paulo wall-clock value is midnight.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = parseDateTimeParts(candidate);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    candidate += target - actualAsUtc;
  }
  return candidate;
}

function parseDateTimeParts(timestamp: number): CalendarParts & { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    year: "numeric",
    hour12: false,
    timeZone: UPLOAD_HEALTH_TIME_ZONE,
  }).formatToParts(new Date(timestamp));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

export function getSaoPauloDateKey(timestamp: number): string {
  return dateKey(parseDateParts(timestamp));
}

export function getUploadHealthWindow(now = Date.now()) {
  const today = parseDateParts(now);
  const oldest = addCalendarDays(today, -(UPLOAD_HEALTH_DAYS - 1));
  const tomorrow = addCalendarDays(today, 1);
  return {
    from: localMidnight(oldest),
    toExclusive: localMidnight(tomorrow),
    dates: Array.from({ length: UPLOAD_HEALTH_DAYS }, (_, index) => {
      const parts = addCalendarDays(oldest, index);
      return { key: dateKey(parts), timestamp: localMidnight(parts) };
    }),
  };
}

export function sanitizeTechnicalMessage(message: unknown): string | null {
  if (typeof message !== "string") return null;
  const sanitized = message
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, UPLOAD_EVENT_MAX_MESSAGE_LENGTH);
  return sanitized || null;
}

function sanitizeSourceMatchId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const sanitized = value.replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 128);
  return sanitized || null;
}

export function firstReplayTurnNo(document: ReplayDocument): number | null {
  for (const frame of document.match.frames) {
    const value = frame.payload?.turnNo;
    if (value === undefined || value === null || (typeof value === "string" && !value.trim())) continue;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

export function replayStartedAtT0(document: ReplayDocument): boolean {
  for (const frame of document.match.frames) {
    const value = frame.payload?.turnNo;
    if (value === undefined || value === null || (typeof value === "string" && !value.trim())) continue;
    // Older captures without a turn number are left to the existing replay validator.
    return Number.isFinite(Number(value)) && Number(value) === 0;
  }
  return true;
}

export function classifyUploadAttempt(input: {
  document?: ReplayDocument | null;
  duplicate?: boolean;
  errorCode?: string | null;
}): UploadEventCategory {
  if (input.duplicate) return "duplicate";
  if (input.errorCode === "DUPLICATE_REPLAY") return "duplicate";
  if (["INVALID_UTF8", "INVALID_JSON", "INVALID_STRUCTURE", "STRUCTURE_LIMIT", "INVALID_TIMESTAMP"].includes(input.errorCode || "")) {
    return "corrupt";
  }
  if (input.errorCode) return "error";
  if (input.document && !replayStartedAtT0(input.document)) return "non_t0";
  return input.errorCode ? "error" : "success";
}

export function recordUploadEvent(input: UploadEventInput, now = Date.now()): void {
  const database = getDb();
  database.delete(uploadEvents).where(lt(uploadEvents.attemptedAt, now - UPLOAD_EVENT_RETENTION_MS)).run();
  database.insert(uploadEvents).values({
    attemptedAt: input.attemptedAt ?? now,
    userId: input.userId,
    sourceMatchId: sanitizeSourceMatchId(input.sourceMatchId),
    category: input.category,
    httpStatus: input.httpStatus,
    errorCode: input.errorCode || null,
    technicalMessage: sanitizeTechnicalMessage(input.technicalMessage),
    replayId: input.replayId ?? null,
  }).run();
}

export function cleanupExpiredUploadEvents(now = Date.now()): void {
  getDb().delete(uploadEvents).where(lt(uploadEvents.attemptedAt, now - UPLOAD_EVENT_RETENTION_MS)).run();
}

function emptyCells(): Record<UploadEventCategory, { count: number; percentage: number }> {
  return Object.fromEntries(UPLOAD_EVENT_CATEGORIES.map((category) => [category, { count: 0, percentage: 0 }])) as Record<UploadEventCategory, { count: number; percentage: number }>;
}

function formatWindowLabel(from: string, to: string): string {
  return `${from} – ${to}`;
}

export function getUploadHealthSummary(now = Date.now()): UploadHealthSummary {
  cleanupExpiredUploadEvents(now);
  const window = getUploadHealthWindow(now);
  const rows = getDb()
    .select({ attemptedAt: uploadEvents.attemptedAt, category: uploadEvents.category })
    .from(uploadEvents)
    .where(and(gte(uploadEvents.attemptedAt, window.from), lt(uploadEvents.attemptedAt, window.toExclusive)))
    .all();
  const byDay = new Map(window.dates.map((day) => [day.key, { total: 0, cells: emptyCells() }]));
  const totals = emptyCells();

  for (const row of rows) {
    if (!UPLOAD_EVENT_CATEGORIES.includes(row.category as UploadEventCategory)) continue;
    const category = row.category as UploadEventCategory;
    const day = byDay.get(getSaoPauloDateKey(row.attemptedAt));
    if (!day) continue;
    day.total += 1;
    day.cells[category].count += 1;
    totals[category].count += 1;
  }

  const days = window.dates.map(({ key }) => {
    const value = byDay.get(key)!;
    const cells = emptyCells();
    for (const category of UPLOAD_EVENT_CATEGORIES) {
      cells[category] = {
        count: value.cells[category].count,
        percentage: value.total ? Math.round((value.cells[category].count / value.total) * 1000) / 10 : 0,
      };
    }
    return {
      date: key,
      label: formatHealthDate(key),
      total: value.total,
      cells,
    };
  });
  const dateFrom = window.dates[0].key;
  const dateTo = window.dates.at(-1)!.key;
  return {
    generatedAt: now,
    timeZone: UPLOAD_HEALTH_TIME_ZONE,
    window: { from: dateFrom, to: dateTo, label: formatWindowLabel(formatHealthDate(dateFrom), formatHealthDate(dateTo)) },
    total: rows.length,
    categories: UPLOAD_EVENT_CATEGORIES.map((key) => ({ key, label: UPLOAD_EVENT_CATEGORY_LABELS[key], total: totals[key].count })),
    days,
  };
}

function formatHealthDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return shortDateFormatter.format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function listUploadEventDetails(
  date: string,
  category: UploadEventCategory,
  page = 1,
  now = Date.now(),
): UploadEventPage {
  cleanupExpiredUploadEvents(now);
  const window = getUploadHealthWindow(now);
  const selected = window.dates.find((item) => item.key === date);
  if (!selected) {
    return { items: [], page: 1, pageSize: UPLOAD_EVENT_PAGE_SIZE, total: 0, pageCount: 0 };
  }
  const dayIndex = window.dates.findIndex((item) => item.key === date);
  const next = window.dates[dayIndex + 1]?.timestamp ?? window.toExclusive;
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const condition = and(
    gte(uploadEvents.attemptedAt, selected.timestamp),
    lt(uploadEvents.attemptedAt, next),
    eq(uploadEvents.category, category),
  );
  const database = getDb();
  const total = database
    .select({ value: count() })
    .from(uploadEvents)
    .where(condition)
    .get()?.value ?? 0;
  const pageCount = Math.ceil(total / UPLOAD_EVENT_PAGE_SIZE);
  const offset = (Math.min(safePage, Math.max(pageCount, 1)) - 1) * UPLOAD_EVENT_PAGE_SIZE;
  const rows = database
    .select({ event: uploadEvents, username: users.username })
    .from(uploadEvents)
    .innerJoin(users, eq(users.id, uploadEvents.userId))
    .where(condition)
    .orderBy(desc(uploadEvents.attemptedAt), desc(uploadEvents.id))
    .limit(UPLOAD_EVENT_PAGE_SIZE)
    .offset(offset)
    .all();
  return {
    items: rows.map(({ event, username }) => ({
      id: event.id,
      attemptedAt: event.attemptedAt,
      username,
      sourceMatchId: event.sourceMatchId,
      category: event.category as UploadEventCategory,
      httpStatus: event.httpStatus,
      errorCode: event.errorCode,
      technicalMessage: event.technicalMessage,
      replayId: event.replayId,
    })),
    page: Math.min(safePage, Math.max(pageCount, 1)),
    pageSize: UPLOAD_EVENT_PAGE_SIZE,
    total,
    pageCount,
  };
}

export function safeUploadEventCategory(value: string | null): UploadEventCategory | null {
  return value && UPLOAD_EVENT_CATEGORIES.includes(value as UploadEventCategory)
    ? value as UploadEventCategory
    : null;
}
