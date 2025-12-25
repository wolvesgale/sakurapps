export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { updateDayApproval } from "@/lib/attendance";
import { getOrCreateDefaultStore } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();

    if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const dateInput = body?.date;
    const approved = Boolean(body?.approved);

    if (!dateInput || typeof dateInput !== "string") {
      return NextResponse.json({ error: "date is required" }, { status: 400 });
    }

    const parsedDate = new Date(dateInput);
    if (Number.isNaN(parsedDate.getTime())) {
      return NextResponse.json({ error: "invalid date" }, { status: 400 });
    }

    const defaultStore = await getOrCreateDefaultStore();
    const storeId = session.user.storeId ?? defaultStore.id;

    await updateDayApproval({
      storeId,
      date: parsedDate,
      approved,
      approverId: session.user.id
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[admin/attendance/approve-day]", error);
    return NextResponse.json({ error: "Failed to update approval" }, { status: 500 });
  }
}
