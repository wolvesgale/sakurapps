export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { endOfMonth, startOfMonth } from "date-fns";
import { getAttendancePhotosByMonth } from "@/lib/attendance-photo";
import { getCurrentSession } from "@/lib/session";
import { getOrCreateDefaultStore } from "@/lib/store";

export async function GET(req: Request) {
  try {
    const session = await getCurrentSession();
    if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const monthParam = searchParams.get("month");
    const staffId = searchParams.get("staffId") ?? undefined;

    const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? new Date(`${monthParam}-01`) : new Date();
    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(monthStart);

    const defaultStore = await getOrCreateDefaultStore();

    const photos = await getAttendancePhotosByMonth({
      storeId: session.user.storeId ?? defaultStore.id,
      staffId,
      monthStart,
      monthEnd
    });

    return NextResponse.json({ photos });
  } catch (error) {
    console.error("[attendance-photos] GET", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
