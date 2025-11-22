export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const { storeId, terminalId } = (await request.json()) as {
      storeId?: string;
      terminalId?: string;
    };

    if (!storeId || !terminalId) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const terminal = await prisma.terminal.findFirst({
      where: { storeId, deviceId: terminalId, isActive: true },
      include: { store: true }
    });

    if (!terminal) {
      return NextResponse.json({ error: "Unauthorized terminal" }, { status: 403 });
    }

    return NextResponse.json({
      authorized: true,
      store: { id: terminal.storeId, name: terminal.store.name },
      terminalId: terminal.deviceId,
      label: terminal.label ?? null
    });
  } catch (error) {
    console.error("[terminal-authorize] POST", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
