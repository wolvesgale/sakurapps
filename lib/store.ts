import { prisma } from "./prisma";

export const DEFAULT_STORE_NAME = "Nest SAKURA";

export async function getOrCreateDefaultStore() {
  try {
    const existing = await prisma.store.findFirst({
      where: { name: DEFAULT_STORE_NAME }
    });

    if (existing) {
      return existing;
    }

    return await prisma.store.create({
      data: {
        name: DEFAULT_STORE_NAME,
        // TODO: allow configuring address/hours from dashboard when multi-store support returns
        openingTime: null,
        closingTime: null
      }
    });
  } catch (error) {
    console.error("[store:getOrCreateDefaultStore] fallback store", error);
    // Ensure callers always receive a usable object so pages don't 500 even if DB is unreachable.
    return {
      id: "dev-store",
      name: DEFAULT_STORE_NAME,
      address: null,
      openingTime: null,
      closingTime: null,
      createdAt: new Date(),
      updatedAt: new Date()
    } as const;
  }
}
