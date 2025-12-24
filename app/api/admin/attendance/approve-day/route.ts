// app/api/admin/attendance/approve-day/route.ts
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { updateDayApproval } from "@/lib/attendance";
import { getOrCreateDefaultStore } from "@/lib/store";

function parseYmdAsJstDate(input: string) {
  // "YYYY-MM-DD" を JSTの 00:00 として扱う
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;

  // JST 00:00 = UTC 前日 15:00
  return new Date(Date.UTC(y, mo - 1, d, -9, 0, 0, 0));
}

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

    const parsedDate = parseYmdAsJstDate(dateInput);
    if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
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
