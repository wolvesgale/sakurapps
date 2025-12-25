// app/api/terminal/attendance/route.ts
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyTerminalAccess } from "@/lib/terminal";
import { getOrCreateDefaultStore } from "@/lib/store";

const allowedTypes = ["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"] as const;
type AttendanceType = (typeof allowedTypes)[number];

export async function POST(request: Request) {
  try {
    const { staffId, storeId, terminalId, type, action, isCompanion, photoUrl } =
      (await request.json()) as {
        staffId?: string;
        storeId?: string;
        terminalId?: string;
        type?: AttendanceType;
        action?: AttendanceType;
        isCompanion?: boolean;
        photoUrl?: string;
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

    const staff = await prisma.user.findFirst({
      where: {
        id: staffId,
        role: { in: ["CAST", "DRIVER"] },
        isActive: true,
      },
    });

    if (!staff) {
      return NextResponse.json({ error: "Staff not found" }, { status: 404 });
    }

    if (terminal.storeId !== targetStoreId) {
      return NextResponse.json({ error: "Store mismatch" }, { status: 400 });
    }

    if (staff.storeId && staff.storeId !== targetStoreId) {
      return NextResponse.json({ error: "Store mismatch" }, { status: 400 });
    }

    // ✅ 承認/未承認による制限はしない（仕様変更）

    if (resolvedType === "CLOCK_IN" && !photoUrl) {
      return NextResponse.json({ error: "出勤時の写真が必要です" }, { status: 400 });
    }

    const attendance = await prisma.$transaction(async (tx) => {
      const created = await tx.attendance.create({
        data: {
          userId: staff.id,
          storeId: targetStoreId,
          type: resolvedType,
          timestamp: new Date(),
          isCompanion: resolvedType === "CLOCK_IN" ? Boolean(isCompanion) : false,
        },
      });

      if (resolvedType === "CLOCK_IN" && photoUrl) {
        await tx.attendancePhoto.create({
          data: {
            attendanceId: created.id,
            storeId: targetStoreId,
            staffId: staff.id,
            photoUrl,
          },
        });
      }

      return created;
    });

    return NextResponse.json({ attendance });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    const isSchemaMissing =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2021" || error.code === "P2022");

    if (isSchemaMissing) {
      console.error("[terminal-attendance] attendancePhoto table missing", error);
      return NextResponse.json(
        { error: "出勤写真の保存に失敗しました。最新のマイグレーションを適用してください。" },
        { status: 500 }
      );
    }

    console.error("[terminal-attendance] POST", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
