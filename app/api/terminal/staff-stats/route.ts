export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { addDays, endOfMonth, startOfMonth } from "date-fns";
import { prisma } from "@/lib/prisma";
import { getOrCreateDefaultStore } from "@/lib/store";
import { NIGHT_CUTOFF_HOUR, calculateMonthlySummaryFromRecords } from "@/lib/attendance";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const staffId = searchParams.get("staffId");
    const providedStoreId = searchParams.get("storeId");

    if (!staffId) {
      return NextResponse.json({ error: "staffId is required" }, { status: 400 });
    }

    const storeId = providedStoreId ?? (await getOrCreateDefaultStore()).id;

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed
    const monthStart = startOfMonth(new Date(year, month, 1));
    const monthEnd = addDays(endOfMonth(monthStart), 1);
    const jstOffsetHours = 9;
    const queryStart = new Date(monthStart.getTime() - (jstOffsetHours - NIGHT_CUTOFF_HOUR) * 3600000);

    const [attendanceRecords, sales, companionRecords] = await Promise.all([
      prisma.attendance.findMany({
        where: {
          storeId,
          userId: staffId,
          timestamp: { gte: queryStart, lt: monthEnd }
        },
        orderBy: { timestamp: "asc" }
      }),
      prisma.sale.findMany({
        where: {
          storeId,
          staffId,
          createdAt: { gte: monthStart, lt: monthEnd }
        }
      }),
      prisma.attendance.findMany({
        where: {
          storeId,
          userId: staffId,
          type: "CLOCK_IN",
          isCompanion: true,
          timestamp: { gte: queryStart, lt: monthEnd }
        }
      })
    ]);

    const summary = calculateMonthlySummaryFromRecords(attendanceRecords);
    const totalSales = sales.reduce((sum, s) => sum + s.amount, 0);
    const companionCount = companionRecords.length;

    return NextResponse.json({
      workingMinutes: summary.roundedMinutes,
      workingHours: summary.roundedHours,
      workingRemainderMinutes: summary.roundedRemainderMinutes,
      totalSales,
      companionCount
    });
  } catch (error) {
    console.error("[staff-stats] GET", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
