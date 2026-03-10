import { addDays, endOfMonth, format, startOfDay, startOfMonth } from "date-fns";
import type { Attendance } from "@prisma/client";
import { prisma } from "./prisma";
import { getOrCreateDefaultStore } from "./store";

/** JST で深夜この時刻より前の打刻は「前営業日」扱いにする境界時刻 */
export const NIGHT_CUTOFF_HOUR = 6;

const TZ = "Asia/Tokyo";

/**
 * タイムスタンプから「営業日」の Date を返す。
 * JST で NIGHT_CUTOFF_HOUR 時より前の打刻は前日営業日扱い。
 */
export function getBusinessDate(timestamp: Date): Date {
  const jst = new Date(timestamp.toLocaleString("en-US", { timeZone: TZ }));
  if (jst.getHours() < NIGHT_CUTOFF_HOUR) {
    jst.setDate(jst.getDate() - 1);
  }
  return startOfDay(jst);
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
  date: Date;
  approved: boolean;
  approverId: string;
};

type RangeSummaryParams = {
  storeId?: string;
  staffId?: string;
  startDate: Date;
  endDate: Date;
};

/**
 * 指定された日付の「営業日」UTC範囲を返す。
 * 営業日は JST NIGHT_CUTOFF_HOUR 時から翌日 NIGHT_CUTOFF_HOUR 時まで。
 */
export function getDayRange(date: Date) {
  const dateStr = format(date, "yyyy-MM-dd");
  const hour = String(NIGHT_CUTOFF_HOUR).padStart(2, "0");
  const from = new Date(`${dateStr}T${hour}:00:00+09:00`);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from, to };
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
          if (diff > 0) {
            minutes += diff;
          }
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
    const businessDate = format(getBusinessDate(record.timestamp), "yyyy-MM-dd");
    const key = `${record.userId}-${businessDate}`;
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
  // 月初の NIGHT_CUTOFF_HOUR 時前のレコード（前日UTCに属する）を取りこぼさないよう遡る
  const jstOffsetHours = 9;
  const queryStart = new Date(monthStart.getTime() - (jstOffsetHours - NIGHT_CUTOFF_HOUR) * 3600000);

  const records = await prisma.attendance.findMany({
    where: {
      storeId: targetStoreId,
      timestamp: { gte: queryStart, lt: monthEnd },
      ...(staffId ? { userId: staffId } : {})
    },
    orderBy: { timestamp: "asc" }
  });

  return calculateMonthlySummaryFromRecords(records);
}

export async function getAttendanceSummaryForRange({
  storeId,
  staffId,
  startDate,
  endDate
}: RangeSummaryParams) {
  const targetStoreId = storeId ?? (await getOrCreateDefaultStore()).id;
  const jstOffsetHours = 9;
  const queryStart = new Date(startDate.getTime() - (jstOffsetHours - NIGHT_CUTOFF_HOUR) * 3600000);

  const records = await prisma.attendance.findMany({
    where: {
      storeId: targetStoreId,
      timestamp: { gte: queryStart, lt: endDate },
      ...(staffId ? { userId: staffId } : {})
    },
    orderBy: { timestamp: "asc" }
  });

  return calculateMonthlySummaryFromRecords(records);
}

export async function updateDayApproval({ storeId, date, approved, approverId }: DayApprovalParams) {
  const targetStoreId = storeId ?? (await getOrCreateDefaultStore()).id;
  const { from, to } = getDayRange(date);
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

  await prisma.attendanceApproval.upsert({
    where: { storeId_date: { storeId: targetStoreId, date: from } },
    update: {
      isApproved: approved,
      approvedAt,
      approvedById
    },
    create: {
      storeId: targetStoreId,
      date: from,
      isApproved: approved,
      approvedAt,
      approvedById
    }
  });

  return { ok: true };
}
