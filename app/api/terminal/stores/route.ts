export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateDefaultStore } from "@/lib/store";

export async function GET() {
  try {
    const defaultStore = await getOrCreateDefaultStore();

    const casts = await prisma.user.findMany({
      where: {
        isActive: true,
        storeId: defaultStore.id,
        role: { in: ["CAST", "DRIVER"] }
      },
      select: { id: true, displayName: true, role: true },
      orderBy: { displayName: "asc" }
    });

    return NextResponse.json({
      stores: [
        {
          id: defaultStore.id,
          name: defaultStore.name,
          openingTime: defaultStore.openingTime,
          closingTime: defaultStore.closingTime,
          casts
        }
      ]
    });
  } catch (error) {
    console.error("[terminal-stores] GET", error);
    return NextResponse.json({ stores: [] }, { status: 200 });
  }
}
