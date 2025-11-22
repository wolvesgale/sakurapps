export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyTerminalAccess } from "@/lib/terminal";

const allowedTypes = ["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"] as const;

type AttendanceType = (typeof allowedTypes)[number];

export async function POST(request: Request) {
  try {
    const { userId, storeId, terminalId, type } = (await request.json()) as {
      userId?: string;
      storeId?: string;
      terminalId?: string;
      type?: AttendanceType;
    };

    if (!userId || !type || !allowedTypes.includes(type) || !storeId || !terminalId) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const terminal = await verifyTerminalAccess(storeId, terminalId);

    if (!terminal) {
      return NextResponse.json({ error: "Unauthorized terminal" }, { status: 403 });
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

    if (terminal.storeId !== targetStoreId) {
      return NextResponse.json({ error: "Store mismatch" }, { status: 400 });
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
