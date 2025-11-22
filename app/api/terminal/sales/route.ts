export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const saleCategories = ["SET", "DRINK", "BOTTLE", "OTHER"] as const;

type SaleCategory = (typeof saleCategories)[number];

export async function POST(request: Request) {
  try {
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
        ...(storeId ? { storeId } : {})
      }
    });

    if (!cast) {
      return NextResponse.json({ error: "Cast not found" }, { status: 404 });
    }

    if (storeId && cast.storeId && cast.storeId !== storeId) {
      return NextResponse.json({ error: "Store mismatch" }, { status: 400 });
    }

    const targetStoreId = storeId ?? cast.storeId;

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
  } catch (error) {
    console.error("[terminal-sales] POST", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
