export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const stores = await prisma.store.findMany({
      include: {
        users: {
          where: { role: "CAST", isActive: true },
          select: { id: true, displayName: true }
        }
      }
    });

    return NextResponse.json({
      stores: stores.map((store) => ({
        id: store.id,
        name: store.name,
        openingTime: store.openingTime,
        closingTime: store.closingTime,
        casts: store.users
      }))
    });
  } catch (error) {
    console.error("[terminal-stores] GET", error);
    return NextResponse.json({ stores: [] }, { status: 200 });
  }
}
