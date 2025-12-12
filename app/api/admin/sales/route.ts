export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { addDays, startOfDay } from "date-fns";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { getOrCreateDefaultStore } from "@/lib/store";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();

    if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const dateParam = url.searchParams.get("date");
    const staffIdParam = url.searchParams.get("staffId") ?? undefined;

    if (!dateParam) {
      return NextResponse.json({ error: "date is required" }, { status: 400 });
    }

    const parsedDate = new Date(dateParam);
    if (Number.isNaN(parsedDate.getTime())) {
      return NextResponse.json({ error: "invalid date" }, { status: 400 });
    }

    const { id: defaultStoreId } = await getOrCreateDefaultStore();
    const storeId = session.user.storeId ?? defaultStoreId;

    const from = startOfDay(parsedDate);
    const to = addDays(from, 1);

    const sales = await prisma.sale.findMany({
      where: {
        storeId,
        createdAt: { gte: from, lt: to },
        ...(staffIdParam && staffIdParam !== "__all__" ? { staffId: staffIdParam } : {})
      },
      include: { staff: true },
      orderBy: { createdAt: "asc" }
    });

    return NextResponse.json({
      sales: sales.map((sale) => ({
        id: sale.id,
        staffId: sale.staffId,
        staffName: sale.staff?.displayName ?? "スタッフ不明",
        paymentMethod: sale.paymentMethod,
        amount: sale.amount,
        createdAt: sale.createdAt
      }))
    });
  } catch (error) {
    console.error("[admin/sales] GET", error);
    return NextResponse.json({ error: "Failed to load sales" }, { status: 500 });
  }
}
