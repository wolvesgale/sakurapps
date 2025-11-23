export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyTerminalAccess } from "@/lib/terminal";
import { getOrCreateDefaultStore } from "@/lib/store";

const paymentMethods = ["CASH", "PAYPAY", "CARD"] as const;

type PaymentMethod = (typeof paymentMethods)[number];

export async function POST(request: Request) {
  try {
    const { staffId, storeId, paymentMethod, amount, terminalId } =
      (await request.json()) as {
        staffId?: string;
        storeId?: string;
        paymentMethod?: PaymentMethod;
        amount?: number;
        terminalId?: string;
      };

    if (
      !staffId ||
      !paymentMethod ||
      !paymentMethods.includes(paymentMethod) ||
      typeof amount !== "number" ||
      Number.isNaN(amount)
    ) {
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

    const sale = await prisma.sale.create({
      data: {
        staffId: cast.id,
        storeId: targetStoreId,
        paymentMethod,
        amount: Math.trunc(amount)
      }
    });

    return NextResponse.json({ sale });
  } catch (error) {
    console.error("[terminal-sales] POST", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
