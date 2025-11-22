import { prisma } from "@/lib/prisma";

export async function verifyTerminalAccess(storeId: string, deviceId: string) {
  if (!storeId || !deviceId) return null;
  return prisma.terminal.findFirst({
    where: { storeId, deviceId, isActive: true },
    include: { store: true }
  });
}
