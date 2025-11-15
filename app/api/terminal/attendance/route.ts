export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const allowedTypes = ["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"] as const;

type AttendanceType = (typeof allowedTypes)[number];

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();

    if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId, storeId, type } = (await request.json()) as {
      userId?: string;
      storeId?: string;
      type?: AttendanceType;
    };

    if (!userId || !type || !allowedTypes.includes(type)) {
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

    const attendance = await prisma.attendance.create({
      data: {
        userId: cast.id,
        storeId: targetStoreId,
        type,
        timestamp: new Date()
      }
    });

    return NextResponse.json({ attendance });
  } catch (error) {
    console.error("[terminal-attendance] POST", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
