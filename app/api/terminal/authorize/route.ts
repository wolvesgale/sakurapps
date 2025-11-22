export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getOrCreateDefaultStore } from "@/lib/store";

export async function POST(request: Request) {
  const { storeId, terminalId } = await request
    .json()
    .catch(() => ({ storeId: null, terminalId: null })) as {
    storeId?: string | null;
    terminalId?: string | null;
  };

  const fallbackStore = storeId
    ? { id: storeId }
    : await getOrCreateDefaultStore();
  const fallbackTerminalId = terminalId ?? "dev-device";

  return NextResponse.json({
    ok: true,
    terminal: {
      id: "dev-terminal",
      deviceId: fallbackTerminalId,
      storeId: fallbackStore.id
    }
  });
}
