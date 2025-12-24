// lib/attendance.ts
import type { Attendance } from "@prisma/client";
import { prisma } from "./prisma";
import { getOrCreateDefaultStore } from "./store";
// Import necessary date utility functions from date-fns
import { addDays, startOfMonth, endOfMonth } from "date-fns";

/**
 * JSTパーツを取り出す
 */
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

  const todayEndJst = utcDateFromJst(j.year, j.month, j.day, endHour, 0, 0, 0);
  const todayStartJst = utcDateFromJst(j.year, j.month, j.day, startHour, 0, 0, 0);

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

/**
 * カレンダーで選んだ「営業日ラベル（yyyy-mm-dd）」を
 * その営業日の範囲（18:00〜翌06:00 JST）に変換する。
 *
 * dateInput は "2025-12-23" のような日付を想定。
 * - from: 2025-12-23 18:00 JST
 * - to  : 2025-12-24 06:00 JST
 */
export function getBusinessDayRangeFromCalendarDateJst(
  dateInput: Date,
  { startHour = 18, endHour = 6 }: { startHour?: number; endHour?: number } = {}
) {
  const j = getJstParts(dateInput);
  const from = utcDateFromJst(j.year, j.month, j.day, startHour, 0, 0, 0);
  const to = utcDateFromJst(j.year, j.month, j.day + 1, endHour, 0, 0, 0);
  return { from, to };
}

/**
 * 任意の打刻 timestamp が属する「営業日ラベル」を返す（JST基準）
 * - 18:00〜23:59 -> 当日
 * - 00:00〜(6:00+grace) -> 前日扱い
 * - 日中帯も前日扱い（仕様に合わせる）
 */
export function getBusinessDayKeyJst(
  timestamp: Date,
  {
    startHour = 18,
    endHour = 6,
    graceMinutes = 120
  }: { startHour?: number; endHour?: number; graceMinutes?: number } = {}
) {
  // NOTE: `to` is not needed here; keep only `from` to satisfy no-unused-vars.
  const { from } = getBusinessDayRangeJst(timestamp, { startHour, endHour, graceMinutes });
  // 営業日の "from" に対応する JST日付をキーにする
  const parts = getJstParts(from);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

type MonthlySummaryResult = {
  totalMinutes: number;
  roundedMinutes: number;
  roundedHours: number;
  roundedRemainderMinutes: number;
};

type MonthlySummaryParams = {
  storeId?: string;
  staffId?: string;
  year: number;
  month: number; // 1-12
};

type DayApprovalParams = {
  storeId?: string;
  date: Date; // カレンダーで選んだ日付（営業日ラベル）
  approved: boolean;
  approverId: string;
};

/**
 * ここは「日付そのもの」ではなく「営業日ラベル」を元に範囲を決めるように変更済み。
 */
export function getDayRange(date: Date) {
  return getBusinessDayRangeFromCalendarDateJst(date, { startHour: 18, endHour: 6 });
}

function calculateDayMinutes(records: Attendance[]): number {
  const sorted = [...records].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  let currentStart: Date | null = null;
  let minutes = 0;

  for (const record of sorted) {
    switch (record.type) {
      case "CLOCK_IN":
        currentStart = record.timestamp;
        break;
      case "BREAK_START":
      case "CLOCK_OUT":
        if (currentStart) {
          const diff = (record.timestamp.getTime() - currentStart.getTime()) / (1000 * 60);
          if (diff > 0) minutes += diff;
          currentStart = null;
        }
        break;
      case "BREAK_END":
        currentStart = record.timestamp;
        break;
      default:
        break;
    }
  }

  return minutes;
}

export function calculateMonthlySummaryFromRecords(records: Attendance[]): MonthlySummaryResult {
  const grouped = new Map<string, Attendance[]>();
  let totalMinutes = 0;
  let roundedMinutes = 0;

  for (const record of records) {
    // ★ここが超重要：暦日ではなく営業日キーで集計する
    const dayKey = getBusinessDayKeyJst(record.timestamp, {
      startHour: 18,
      endHour: 6,
      graceMinutes: 120
    });
    const key = `${record.userId}-${dayKey}`;

    const list = grouped.get(key) ?? [];
    list.push(record);
    grouped.set(key, list);
  }

  grouped.forEach((dayRecords) => {
    const minutes = calculateDayMinutes(dayRecords);
    const rounded = Math.ceil(minutes / 15) * 15;
    totalMinutes += minutes;
    roundedMinutes += rounded;
  });

  return {
    totalMinutes,
    roundedMinutes,
    roundedHours: Math.floor(roundedMinutes / 60),
    roundedRemainderMinutes: roundedMinutes % 60
  };
}

export async function getMonthlyAttendanceSummary({ storeId, staffId, year, month }: MonthlySummaryParams) {
  const targetStoreId = storeId ?? (await getOrCreateDefaultStore()).id;
  const monthStart = startOfMonth(new Date(year, month - 1, 1));
  const monthEnd = addDays(endOfMonth(monthStart), 1);

  const records = await prisma.attendance.findMany({
    where: {
      storeId: targetStoreId,
      timestamp: { gte: monthStart, lt: monthEnd },
      ...(staffId ? { userId: staffId } : {})
    },
    orderBy: { timestamp: "asc" }
  });

  return calculateMonthlySummaryFromRecords(records);
}

/**
 * 承認は「営業日範囲」に対して Attendance に approvedAt/approvedById を付与する。
 * ただし、AttendanceApproval（店×日）も “表示用の状態” としては残してOK。
 *
 * 重要:
 * - ここで AttendanceApproval を更新してもよいが
 * - ターミナル打刻を「日単位承認」で止めるのは禁止（別ファイルで修正）
 */
export async function updateDayApproval({ storeId, date, approved, approverId }: DayApprovalParams) {
  const targetStoreId = storeId ?? (await getOrCreateDefaultStore()).id;

  // ★暦日ではなく営業日（18:00〜翌06:00）を対象にする
  const { from, to } = getBusinessDayRangeFromCalendarDateJst(date, { startHour: 18, endHour: 6 });

  const approvedAt = approved ? new Date() : null;
  const approvedById = approved ? approverId : null;

  await prisma.attendance.updateMany({
    where: {
      storeId: targetStoreId,
      timestamp: { gte: from, lt: to }
    },
    data: {
      approvedAt,
      approvedById
    }
  });

  // ★AttendanceApproval は「営業日ラベル（JSTの 00:00）」で一意に持つ
  const j = getJstParts(date);
  const labelDate = utcDateFromJst(j.year, j.month, j.day, 0, 0, 0, 0);

  await prisma.attendanceApproval.upsert({
    where: { storeId_date: { storeId: targetStoreId, date: labelDate } },
    update: {
      isApproved: approved,
      approvedAt,
      approvedById
    },
    create: {
      storeId: targetStoreId,
      date: labelDate,
      isApproved: approved,
      approvedAt,
      approvedById
    }
  });

  return { ok: true };
}
