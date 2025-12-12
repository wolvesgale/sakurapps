export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import type { PaymentMethod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { getOrCreateDefaultStore } from "@/lib/store";

function isPaymentMethod(value: string): value is PaymentMethod {
  return value === "CASH" || value === "PAYPAY" || value === "CARD";
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getCurrentSession();

    if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = params;
    const body = await request.json();
    const amount = Number(body?.amount);
    const paymentMethod = body?.paymentMethod as string | undefined;

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    if (!paymentMethod || !isPaymentMethod(paymentMethod)) {
      return NextResponse.json({ error: "Invalid payment method" }, { status: 400 });
    }

    const defaultStore = await getOrCreateDefaultStore();
    const storeId = session.user.storeId ?? defaultStore.id;

    const existing = await prisma.sale.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Sale not found" }, { status: 404 });
    }

    if (existing.storeId !== storeId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updated = await prisma.sale.update({
      where: { id },
      data: { amount: Math.trunc(amount), paymentMethod }
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[admin/sales/:id] PATCH", error);
    return NextResponse.json({ error: "Failed to update sale" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getCurrentSession();

    if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = params;

    const defaultStore = await getOrCreateDefaultStore();
    const storeId = session.user.storeId ?? defaultStore.id;

    const existing = await prisma.sale.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Sale not found" }, { status: 404 });
    }

    if (existing.storeId !== storeId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.sale.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[admin/sales/:id] DELETE", error);
    return NextResponse.json({ error: "Failed to delete sale" }, { status: 500 });
  }
}
