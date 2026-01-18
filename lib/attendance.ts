import { addDays, endOfMonth, format, startOfDay, startOfMonth } from "date-fns";
import type { Attendance } from "@prisma/client";
import { prisma } from "./prisma";
import { getOrCreateDefaultStore } from "./store";

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

export function getDayRange(date: Date) {
  const from = startOfDay(date);
  const to = addDays(from, 1);
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
    const key = `${record.userId}-${format(record.timestamp, "yyyy-MM-dd")}`;
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

export async function getAttendanceSummaryForRange({
  storeId,
  staffId,
  startDate,
  endDate
}: RangeSummaryParams) {
  const targetStoreId = storeId ?? (await getOrCreateDefaultStore()).id;
  const records = await prisma.attendance.findMany({
    where: {
      storeId: targetStoreId,
      timestamp: { gte: startDate, lt: endDate },
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
