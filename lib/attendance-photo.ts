import { addDays } from "date-fns";
import { del } from "@vercel/blob";
import { prisma } from "./prisma";
import { getOrCreateDefaultStore } from "./store";

const RETENTION_DAYS = 2;

export async function pruneOldAttendancePhotos() {
  const cutoff = addDays(new Date(), -RETENTION_DAYS);
  const oldPhotos = await prisma.attendancePhoto.findMany({
    where: { createdAt: { lt: cutoff } }
  });

  for (const photo of oldPhotos) {
    if (photo.photoUrl) {
      try {
        await del(photo.photoUrl);
      } catch (error) {
        console.error("[attendance-photo] failed to delete blob", { url: photo.photoUrl, error });
      }
    }
  }

  if (oldPhotos.length > 0) {
    await prisma.attendancePhoto.deleteMany({ where: { id: { in: oldPhotos.map((p) => p.id) } } });
  }
}

export async function getAttendancePhotosByMonth({
  storeId,
  staffId,
  monthStart,
  monthEnd
}: {
  storeId?: string;
  staffId?: string;
  monthStart: Date;
  monthEnd: Date;
}) {
  const targetStoreId = storeId ?? (await getOrCreateDefaultStore()).id;
  await pruneOldAttendancePhotos();

  return prisma.attendancePhoto.findMany({
    where: {
      storeId: targetStoreId,
      createdAt: { gte: monthStart, lt: addDays(monthEnd, 1) },
      ...(staffId ? { staffId } : {})
    },
    include: {
      attendance: true,
      staff: true
    },
    orderBy: { createdAt: "asc" }
  });
}

export async function getAttendancePhotosForDate({
  storeId,
  date,
  staffId
}: {
  storeId?: string;
  date: Date;
  staffId?: string;
}) {
  const from = new Date(date.getTime());
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime());
  to.setDate(to.getDate() + 1);

  const targetStoreId = storeId ?? (await getOrCreateDefaultStore()).id;
  await pruneOldAttendancePhotos();

  return prisma.attendancePhoto.findMany({
    where: {
      storeId: targetStoreId,
      createdAt: { gte: from, lt: to },
      ...(staffId ? { staffId } : {})
    },
    include: { attendance: true, staff: true },
    orderBy: { createdAt: "asc" }
  });
}
