export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyTerminalAccess } from "@/lib/terminal";
import { getOrCreateDefaultStore } from "@/lib/store";
import { addDays, startOfDay } from "date-fns";

const allowedTypes = ["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"] as const;

type AttendanceType = (typeof allowedTypes)[number];

export async function POST(request: Request) {
  try {
    const { staffId, storeId, terminalId, type, action, isCompanion } =
      (await request.json()) as {
        staffId?: string;
        storeId?: string;
        terminalId?: string;
        type?: AttendanceType;
        action?: AttendanceType;
        isCompanion?: boolean;
      };

    const normalizedType = (action ?? type)
      ? (action ?? type)?.toString().replace(/-/g, "_").toUpperCase()
      : undefined;

    const resolvedType = allowedTypes.find((candidate) => candidate === normalizedType);

    if (!staffId || !resolvedType || !allowedTypes.includes(resolvedType)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const defaultStore = await getOrCreateDefaultStore();
    const targetStoreId = storeId ?? defaultStore.id;

    const terminal = await verifyTerminalAccess(targetStoreId, terminalId);

    if (!terminal) {
      return NextResponse.json({ error: "Unauthorized terminal" }, { status: 403 });
    }

    const cast = await prisma.user.findFirst({
      where: {
        id: staffId,
        role: "CAST",
        isActive: true
      }
    });

    if (!cast) {
      return NextResponse.json({ error: "Cast not found" }, { status: 404 });
    }

    if (terminal.storeId !== targetStoreId) {
      return NextResponse.json({ error: "Store mismatch" }, { status: 400 });
    }

    if (cast.storeId && cast.storeId !== targetStoreId) {
      return NextResponse.json({ error: "Store mismatch" }, { status: 400 });
    }

    const dayStart = startOfDay(new Date());
    const dayEnd = addDays(dayStart, 1);

    const dailyApproval = await prisma.attendanceApproval.findFirst({
      where: {
        storeId: targetStoreId,
        date: { gte: dayStart, lt: dayEnd },
        isApproved: true
      }
    });

    if (dailyApproval) {
      return NextResponse.json(
        { error: "この日の勤怠は承認済みのため編集できません" },
        { status: 400 }
      );
    }

    const attendance = await prisma.attendance.create({
      data: {
        userId: cast.id,
        storeId: targetStoreId,
        type: resolvedType,
        timestamp: new Date(),
        isCompanion: resolvedType === "CLOCK_IN" ? Boolean(isCompanion) : false
      }
    });

    return NextResponse.json({ attendance });
  } catch (error) {
    console.error("[terminal-attendance] POST", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
