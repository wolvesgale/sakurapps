import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const saleCategories = ["SET", "DRINK", "BOTTLE", "OTHER"] as const;

type SaleCategory = (typeof saleCategories)[number];

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId, storeId, tableNumber, category, amount } = (await request.json()) as {
    userId?: string;
    storeId?: string;
    tableNumber?: string;
    category?: SaleCategory;
    amount?: number;
  };

  if (!userId || !category || !saleCategories.includes(category) || typeof amount !== "number") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const cast = await prisma.user.findFirst({
    where: {
      id: userId,
      role: "CAST",
      isActive: true,
      ...(session.user.role === "ADMIN" ? { storeId: session.user.storeId ?? undefined } : {}),
      ...(storeId ? { storeId } : {})
    }
  });

  if (!cast) {
    return NextResponse.json({ error: "Cast not found" }, { status: 404 });
  }

  const targetStoreId = cast.storeId ?? storeId;

  if (!targetStoreId) {
    return NextResponse.json({ error: "Store not found" }, { status: 400 });
  }

  const sale = await prisma.sale.create({
    data: {
      userId: cast.id,
      storeId: targetStoreId,
      tableNumber: tableNumber ?? "",
      category,
      amount
    }
  });

  return NextResponse.json({ sale });
}
