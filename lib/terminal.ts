// lib/terminal.ts
import { prisma } from "./prisma";
import { getOrCreateDefaultStore } from "./store";

/**
 * 営業日定義:
 * - 基本: 18:00〜翌06:00 を 1営業日として扱う
 * - 猶予: 06:00直後のズレを前営業日に寄せたい場合のために graceMinutes を用意
 *   例: graceMinutes=120 なら 06:00〜07:59 は前営業日扱い
 */
function getBusinessDayRange(
  now: Date,
  {
    startHour = 18,
    endHour = 6,
    graceMinutes = 120
  }: { startHour?: number; endHour?: number; graceMinutes?: number } = {}
) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  const todayStart = new Date(y, m, d, startHour, 0, 0, 0); // 今日18:00
  const todayEnd = new Date(y, m, d, endHour, 0, 0, 0);     // 今日06:00

  // 「今日06:00」の grace 期限 = 今日06:00 + graceMinutes
  const endWithGrace = new Date(todayEnd.getTime() + graceMinutes * 60 * 1000);

  // ケース分け
  // A) 06:00〜(06:00+grace) は “前営業日”に寄せる
  // B) 18:00以降は “当営業日(今日18:00〜明日06:00)”
  // C) それ以外（08:00〜17:59など）は “前営業日(昨日18:00〜今日06:00)” を表示
  let from: Date;
  let to: Date;

  if (now < endWithGrace) {
    // 前営業日: 昨日18:00〜今日06:00
    from = new Date(y, m, d - 1, startHour, 0, 0, 0);
    to = new Date(y, m, d, endHour, 0, 0, 0);
  } else if (now >= todayStart) {
    // 当営業日: 今日18:00〜明日06:00
    from = new Date(y, m, d, startHour, 0, 0, 0);
    to = new Date(y, m, d + 1, endHour, 0, 0, 0);
  } else {
    // 日中帯: 前営業日（昨日18:00〜今日06:00）
    from = new Date(y, m, d - 1, startHour, 0, 0, 0);
    to = new Date(y, m, d, endHour, 0, 0, 0);
  }

  return { from, to };
}

export async function verifyTerminalAccess(
  storeId?: string | null,
  deviceId?: string | null
) {
  // Development fallback: bypass terminal verification but always scope to the default store
  const defaultStore = await getOrCreateDefaultStore();

  return {
    id: deviceId ?? "dev-terminal",
    deviceId: deviceId ?? "dev-device",
    storeId: storeId ?? defaultStore.id,
    label: "development terminal"
  };
}

export async function getActiveStaffForToday(storeId: string) {
  const { from, to } = getBusinessDayRange(new Date(), {
    startHour: 18,
    endHour: 6,
    graceMinutes: 120 // 必要なら 0 / 60 / 180 などに調整
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
    {
      userId: string;
      displayName: string;
      firstClockIn: Date | null;
      lastType: string | null;
      isCompanion: boolean;
    }
  >();

  for (const attendance of attendances) {
    const current = activeMap.get(attendance.userId) ?? {
      userId: attendance.userId,
      displayName: attendance.user.displayName,
      firstClockIn: null,
      lastType: null,
      isCompanion: false
    };

    // 最初の CLOCK_IN を「出勤開始」として保持
    if (attendance.type === "CLOCK_IN" && !current.firstClockIn) {
      current.firstClockIn = attendance.timestamp;
    }

    // 同伴フラグは「最後に押された CLOCK_IN の値」を採用（後から押し直しがあっても反映できる）
    if (attendance.type === "CLOCK_IN") {
      current.isCompanion = Boolean(attendance.isCompanion);
    }

    current.lastType = attendance.type;
    activeMap.set(attendance.userId, current);
  }

  // 出勤中判定:
  // - 最後が CLOCK_OUT なら退勤済みなので除外
  // - BREAK_START / BREAK_END は出勤中扱い（休憩中を別表示したければ拡張可能）
  return Array.from(activeMap.values())
    .filter((record) => record.lastType && record.lastType !== "CLOCK_OUT")
    .map((record) => ({
      id: record.userId,
      displayName: record.displayName,
      clockInAt: record.firstClockIn,
      isCompanion: record.isCompanion
    }));
}
