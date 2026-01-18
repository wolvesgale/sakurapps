// app/api/terminal/attendance/route.ts
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyTerminalAccess } from "@/lib/terminal";
import { getOrCreateDefaultStore } from "@/lib/store";

const allowedTypes = ["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"] as const;
type AttendanceType = (typeof allowedTypes)[number];

type AttState = "OFF" | "WORKING" | "BREAK";

function normalizeType(input?: string): AttendanceType | undefined {
  if (!input) return undefined;
  const normalized = input.toString().replace(/-/g, "_").toUpperCase();
  return allowedTypes.find((t) => t === normalized);
}

function deriveStateFromLastType(lastType?: AttendanceType): AttState {
  if (!lastType) return "OFF";
  if (lastType === "CLOCK_OUT") return "OFF";
  if (lastType === "BREAK_START") return "BREAK";
  return "WORKING";
}

function isValidTransition(state: AttState, next: AttendanceType): boolean {
  switch (next) {
    case "CLOCK_IN":
      return state === "OFF";
    case "CLOCK_OUT":
      return state === "WORKING" || state === "BREAK";
    case "BREAK_START":
      return state === "WORKING";
    case "BREAK_END":
      return state === "BREAK";
    default:
      return false;
  }
}

/**
 * GET: 出勤中（勤務中/休憩中）のスタッフ一覧
 * - ターミナル画面の「出勤中スタッフ表示」に使う
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const storeId = url.searchParams.get("storeId") ?? undefined;
    const terminalId = url.searchParams.get("terminalId") ?? undefined;

    const defaultStore = await getOrCreateDefaultStore();
    const targetStoreId = storeId ?? defaultStore.id;

    const terminal = await verifyTerminalAccess(targetStoreId, terminalId);
    if (!terminal) return NextResponse.json({ error: "Unauthorized terminal" }, { status: 403 });

    const since = new Date(Date.now() - 1000 * 60 * 60 * 48);
    const recent = await prisma.attendance.findMany({
      where: { storeId: targetStoreId, timestamp: { gte: since } },
      include: { user: true },
      orderBy: { timestamp: "desc" },
      take: 1500
    });

    const lastByUser = new Map<string, { type: AttendanceType; timestamp: Date; displayName: string }>();
    for (const record of recent) {
      if (lastByUser.has(record.userId)) continue;
      lastByUser.set(record.userId, {
        type: record.type as AttendanceType,
        timestamp: record.timestamp,
        displayName: record.user.displayName
      });
    }

    const activeStaff = Array.from(lastByUser.entries())
      .map(([userId, value]) => {
        const state = deriveStateFromLastType(value.type);
        if (state === "OFF") return null;
        return {
          userId,
          displayName: value.displayName,
          state,
          lastType: value.type,
          lastTimestamp: value.timestamp
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (!a || !b) return 0;
        if (a.state !== b.state) return a.state === "WORKING" ? -1 : 1;
        return a.displayName.localeCompare(b.displayName, "ja");
      });

    return NextResponse.json({ activeStaff });
  } catch (error) {
    console.error("[terminal-attendance] GET", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      staffId?: string;
      storeId?: string;
      terminalId?: string;
      type?: string;
      action?: string;
      isCompanion?: boolean;
      photoUrl?: string;
    };

    const staffId = body.staffId;
    const requestedType = normalizeType(body.action ?? body.type);
    const isCompanion = Boolean(body.isCompanion);
    const photoUrl = body.photoUrl;

    if (!staffId || !requestedType) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const defaultStore = await getOrCreateDefaultStore();
    const targetStoreId = body.storeId ?? defaultStore.id;

    const terminal = await verifyTerminalAccess(targetStoreId, body.terminalId ?? undefined);
    if (!terminal) {
      return NextResponse.json({ error: "Unauthorized terminal" }, { status: 403 });
    }

    const staff = await prisma.user.findFirst({
      where: {
        id: staffId,
        role: { in: ["CAST", "DRIVER"] },
        isActive: true
      }
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

    if (requestedType === "CLOCK_IN" && !photoUrl) {
      return NextResponse.json({ error: "出勤時の写真が必要です" }, { status: 400 });
    }

    const last = await prisma.attendance.findFirst({
      where: { userId: staff.id, storeId: targetStoreId },
      orderBy: { timestamp: "desc" },
      select: { type: true }
    });
    const state = deriveStateFromLastType(last?.type as AttendanceType | undefined);

    if (!isValidTransition(state, requestedType)) {
      return NextResponse.json({ error: "勤怠状態を確認してください" }, { status: 400 });
    }

    const now = new Date();

    const attendance = await prisma.$transaction(async (tx) => {
      if (requestedType === "CLOCK_OUT" && state === "BREAK") {
        await tx.attendance.create({
          data: {
            userId: staff.id,
            storeId: targetStoreId,
            type: "BREAK_END",
            timestamp: now,
            isCompanion: false
          }
        });
      }

      const created = await tx.attendance.create({
        data: {
          userId: staff.id,
          storeId: targetStoreId,
          type: requestedType,
          timestamp: now,
          isCompanion: requestedType === "CLOCK_IN" ? isCompanion : false
        }
      });

      if (requestedType === "CLOCK_IN" && photoUrl) {
        await tx.attendancePhoto.create({
          data: {
            attendanceId: created.id,
            storeId: targetStoreId,
            staffId: staff.id,
            photoUrl
          }
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
