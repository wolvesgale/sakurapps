import { prisma } from "./prisma";

export const DEFAULT_STORE_NAME = "Nest SAKURA";

export async function getOrCreateDefaultStore() {
  const existing = await prisma.store.findFirst({
    where: { name: DEFAULT_STORE_NAME }
  });

  if (existing) {
    return existing;
  }

  return prisma.store.create({
    data: {
      name: DEFAULT_STORE_NAME,
      // TODO: allow configuring address/hours from dashboard when multi-store support returns
      openingTime: null,
      closingTime: null
    }
  });
}
