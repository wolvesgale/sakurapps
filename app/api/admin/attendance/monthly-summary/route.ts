export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { getMonthlyAttendanceSummary } from "@/lib/attendance";
import { getOrCreateDefaultStore } from "@/lib/store";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();

    if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const staffIdParam = url.searchParams.get("staffId") ?? undefined;
    const yearParam = Number(url.searchParams.get("year"));
    const monthParam = Number(url.searchParams.get("month"));

    if (!Number.isFinite(yearParam) || !Number.isFinite(monthParam)) {
      return NextResponse.json({ error: "year and month are required" }, { status: 400 });
    }

    if (monthParam < 1 || monthParam > 12) {
      return NextResponse.json({ error: "month must be between 1 and 12" }, { status: 400 });
    }

    const defaultStore = await getOrCreateDefaultStore();
    const storeId = session.user.storeId ?? defaultStore.id;

    const summary = await getMonthlyAttendanceSummary({
      storeId,
      staffId: staffIdParam === "__all__" ? undefined : staffIdParam,
      year: yearParam,
      month: monthParam
    });

    return NextResponse.json(summary);
  } catch (error) {
    console.error("[admin/attendance/monthly-summary]", error);
    return NextResponse.json({ error: "Failed to load summary" }, { status: 500 });
  }
}
