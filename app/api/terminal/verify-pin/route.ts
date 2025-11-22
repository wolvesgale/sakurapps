export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
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
        ...(storeId ? { storeId } : {})
      }
    });

    if (!cast || !cast.castPinHash) {
      return NextResponse.json({ valid: false }, { status: 200 });
    }

    if (storeId && cast.storeId && cast.storeId !== storeId) {
      return NextResponse.json({ error: "Store mismatch" }, { status: 400 });
    }

    const isValid = await compare(pin, cast.castPinHash);

    return NextResponse.json({ valid: isValid });
  } catch (error) {
    console.error("[terminal-verify-pin] POST", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
