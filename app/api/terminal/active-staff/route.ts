export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getActiveStaffForToday } from "@/lib/terminal";
import { getOrCreateDefaultStore } from "@/lib/store";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const providedStoreId = searchParams.get("storeId");

    const store = providedStoreId
      ? { id: providedStoreId }
      : await getOrCreateDefaultStore();

    const activeStaff = await getActiveStaffForToday(store.id);

    return NextResponse.json({ activeStaff });
  } catch (error) {
    console.error("[terminal-active-staff] GET", error);
    return NextResponse.json({ activeStaff: [] }, { status: 200 });
  }
}
