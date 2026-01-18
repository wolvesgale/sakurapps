import { addDays, startOfDay } from "date-fns";
import { prisma } from "./prisma";
import { getOrCreateDefaultStore } from "./store";

export async function verifyTerminalAccess(
  storeId?: string | null,
  deviceId?: string | null
) {
  // Development fallback: bypass terminal verification but always scope to the default store
  const defaultStore = await getOrCreateDefaultStore();

  return {
    id: deviceId ?? "dev-terminal",
    deviceId: deviceId ?? "dev-device",
    storeId: storeId ?? defaultStore.id,
    label: "development terminal"
  };
}

export async function getActiveStaffForToday(storeId: string) {
  const dayStart = startOfDay(new Date());
  const dayEnd = addDays(dayStart, 1);

  const attendances = await prisma.attendance.findMany({
    where: {
      storeId,
      timestamp: { gte: dayStart, lt: dayEnd }
    },
    include: { user: true },
    orderBy: { timestamp: "asc" }
  });

  const activeMap = new Map<
    string,
    {
      userId: string;
      displayName: string;
      firstClockIn: Date | null;
      lastType: string | null;
      isCompanion: boolean;
    }
  >();

  for (const attendance of attendances) {
    const current = activeMap.get(attendance.userId) ?? {
      userId: attendance.userId,
      displayName: attendance.user.displayName,
      firstClockIn: null,
      lastType: null,
      isCompanion: false
    };

    if (attendance.type === "CLOCK_IN" && !current.firstClockIn) {
      current.firstClockIn = attendance.timestamp;
      current.isCompanion = Boolean(attendance.isCompanion);
    }

    current.lastType = attendance.type;
    activeMap.set(attendance.userId, current);
  }

  return Array.from(activeMap.values())
    .filter((record) => record.lastType && record.lastType !== "CLOCK_OUT")
    .map((record) => ({
      id: record.userId,
      displayName: record.displayName,
      clockInAt: record.firstClockIn,
      isCompanion: record.isCompanion
    }));
}
