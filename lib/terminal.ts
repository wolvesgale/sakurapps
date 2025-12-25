import { addDays, startOfDay } from "date-fns";
import { prisma } from "./prisma";
import { getOrCreateDefaultStore } from "./store";

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
  const dayStart = startOfDay(new Date());
  const dayEnd = addDays(dayStart, 1);

  const attendances = await prisma.attendance.findMany({
    where: {
      storeId,
      timestamp: { gte: dayStart, lt: dayEnd }
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

    if (attendance.type === "CLOCK_IN" && !current.firstClockIn) {
      current.firstClockIn = attendance.timestamp;
      current.isCompanion = Boolean(attendance.isCompanion);
    }

    current.lastType = attendance.type;
    activeMap.set(attendance.userId, current);
  }

  return Array.from(activeMap.values())
    .filter((record) => record.lastType && record.lastType !== "CLOCK_OUT")
    .map((record) => ({
      id: record.userId,
      displayName: record.displayName,
      clockInAt: record.firstClockIn,
      isCompanion: record.isCompanion
    }));
}
// JST基準の「営業日」範囲を返す
// - startHour: 営業開始（例: 18）
// - endHour: 営業終了（例: 6）
// - graceMinutes: endHour以降も前営業日扱いにする猶予（例: 120 → 06:00〜07:59は前営業日）
export function getBusinessDayRangeJst(
  now: Date,
  opts: { startHour: number; endHour: number; graceMinutes?: number }
): { from: Date; to: Date } {
  const { startHour, endHour } = opts;
  const graceMinutes = opts.graceMinutes ?? 0;

  const pad2 = (n: number) => String(n).padStart(2, "0");

  const getJstParts = (d: Date) => {
    const dtf = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = dtf.formatToParts(d);
    const pick = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? "0");

    return {
      y: pick("year"),
      m: pick("month"),
      d: pick("day"),
      hh: pick("hour"),
      mm: pick("minute"),
    };
  };

  const ymdFromDateInJst = (d: Date) => {
    const p = getJstParts(d);
    return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
  };

  const nowP = getJstParts(now);
  const minutes = nowP.hh * 60 + nowP.mm;

  const startMin = startHour * 60;
  const endWithGraceMin = endHour * 60 + graceMinutes;

  // JSTの暦日（00:00 JST）を基準にしたDate
  const todayMidnightJst = new Date(
    `${nowP.y}-${pad2(nowP.m)}-${pad2(nowP.d)}T00:00:00+09:00`
  );

  // 18:00以降 → 当日が営業日
  // それ以外 → 前日が営業日（06:00〜17:59 も前営業日扱い）
  const businessBaseJst =
    minutes >= startMin ? todayMidnightJst : new Date(todayMidnightJst.getTime() - 24 * 60 * 60 * 1000);

  const businessYmd = ymdFromDateInJst(businessBaseJst);
  const nextYmd = ymdFromDateInJst(new Date(businessBaseJst.getTime() + 24 * 60 * 60 * 1000));

  const from = new Date(`${businessYmd}T${pad2(startHour)}:00:00+09:00`);
  const to = new Date(`${nextYmd}T${pad2(endHour)}:00:00+09:00`);

  // endWithGrace は「営業日の判定」に使う想定で、範囲自体は endHour で固定（既存仕様を崩さない）
  // もし「to をgrace分伸ばす」仕様が必要なら、ここを変えるのではなく呼び出し側で明示的に扱うこと。
  void endWithGraceMin;

  return { from, to };
}
