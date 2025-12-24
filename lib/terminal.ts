// lib/terminal.ts
import { prisma } from "./prisma";
import { getOrCreateDefaultStore } from "./store";

function getJstParts(date: Date) {
  const dtf = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = dtf.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second")
  };
}

// JSTで指定した日時を「UTCのDate」に変換（JST=UTC+9）
function utcDateFromJst(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  ss = 0,
  ms = 0
) {
  return new Date(Date.UTC(y, m - 1, d, hh - 9, mm, ss, ms));
}

/**
 * 営業日定義（JST固定）:
 * - 基本: 18:00〜翌06:00 を 1営業日として扱う
 * - graceMinutes: 06:00直後のズレを前営業日に寄せる猶予
 *   例: 120 なら 06:00〜07:59 は前営業日扱い
 */
export function getBusinessDayRangeJst(
  now: Date,
  {
    startHour = 18,
    endHour = 6,
    graceMinutes = 120
  }: { startHour?: number; endHour?: number; graceMinutes?: number } = {}
) {
  const j = getJstParts(now);

  // 今日の06:00(JST) と 18:00(JST)
  const todayEndJst = utcDateFromJst(j.year, j.month, j.day, endHour, 0, 0, 0);
  const todayStartJst = utcDateFromJst(j.year, j.month, j.day, startHour, 0, 0, 0);

  // 現在時刻（UTC Date）をそのまま比較してOK（todayEndJst/todayStartJstはUTCに直してあるため）
  const endWithGrace = new Date(todayEndJst.getTime() + graceMinutes * 60 * 1000);

  let from: Date;
  let to: Date;

  if (now < endWithGrace) {
    // 前営業日: 昨日18:00〜今日06:00（JST）
    from = utcDateFromJst(j.year, j.month, j.day - 1, startHour, 0, 0, 0);
    to = utcDateFromJst(j.year, j.month, j.day, endHour, 0, 0, 0);
  } else if (now >= todayStartJst) {
    // 当営業日: 今日18:00〜明日06:00（JST）
    from = utcDateFromJst(j.year, j.month, j.day, startHour, 0, 0, 0);
    to = utcDateFromJst(j.year, j.month, j.day + 1, endHour, 0, 0, 0);
  } else {
    // 日中帯は前営業日を表示
    from = utcDateFromJst(j.year, j.month, j.day - 1, startHour, 0, 0, 0);
    to = utcDateFromJst(j.year, j.month, j.day, endHour, 0, 0, 0);
  }

  return { from, to };
}

export async function verifyTerminalAccess(storeId?: string | null, deviceId?: string | null) {
  const defaultStore = await getOrCreateDefaultStore();
  return {
    id: deviceId ?? "dev-terminal",
    deviceId: deviceId ?? "dev-device",
    storeId: storeId ?? defaultStore.id,
    label: "development terminal"
  };
}

export async function getActiveStaffForToday(storeId: string) {
  const { from, to } = getBusinessDayRangeJst(new Date(), {
    startHour: 18,
    endHour: 6,
    graceMinutes: 120
  });

  const attendances = await prisma.attendance.findMany({
    where: {
      storeId,
      timestamp: { gte: from, lt: to }
    },
    include: { user: true },
    orderBy: { timestamp: "asc" }
  });

  const activeMap = new Map<
    string,
    { userId: string; displayName: string; firstClockIn: Date | null; lastType: string | null; isCompanion: boolean }
  >();

  for (const a of attendances) {
    const current = activeMap.get(a.userId) ?? {
      userId: a.userId,
      displayName: a.user.displayName,
      firstClockIn: null,
      lastType: null,
      isCompanion: false
    };

    if (a.type === "CLOCK_IN" && !current.firstClockIn) current.firstClockIn = a.timestamp;
    if (a.type === "CLOCK_IN") current.isCompanion = Boolean(a.isCompanion);

    current.lastType = a.type;
    activeMap.set(a.userId, current);
  }

  return Array.from(activeMap.values())
    .filter((r) => r.lastType && r.lastType !== "CLOCK_OUT")
    .map((r) => ({
      id: r.userId,
      displayName: r.displayName,
      clockInAt: r.firstClockIn,
      isCompanion: r.isCompanion
    }));
}
