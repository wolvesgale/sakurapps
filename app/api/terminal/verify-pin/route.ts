export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { getCurrentSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();

    if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId, pin, storeId } = (await request.json()) as {
      userId?: string;
      pin?: string;
      storeId?: string;
    };

    if (!userId || !pin) {
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

    if (!cast || !cast.castPinHash) {
      return NextResponse.json({ valid: false }, { status: 200 });
    }

    const isValid = await compare(pin, cast.castPinHash);

    return NextResponse.json({ valid: isValid });
  } catch (error) {
    console.error("[terminal-verify-pin] POST", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
