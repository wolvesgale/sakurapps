// app/(dashboard)/dashboard/attendance/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  addDays,
  differenceInMinutes,
  eachDayOfInterval,
  format,
  isValid,
  startOfDay,
} from "date-fns";
import { ja } from "date-fns/locale";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { getOrCreateDefaultStore } from "@/lib/store";
import { getMonthlyAttendanceSummary, updateDayApproval } from "@/lib/attendance";
import { pruneOldAttendancePhotos } from "@/lib/attendance-photo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

const attendanceLabels: Record<string, string> = {
  CLOCK_IN: "出勤",
  CLOCK_OUT: "退勤",
  BREAK_START: "休憩開始",
  BREAK_END: "休憩終了",
};

const TZ = "Asia/Tokyo";
const toJst = (date: Date) => new Date(date.toLocaleString("en-US", { timeZone: TZ }));

type AttendanceRecord = Prisma.AttendanceGetPayload<{ include: { user: true; approvedBy: true } }>;
type AttendanceApprovalRecord = Prisma.AttendanceApprovalGetPayload<Record<string, never>>;

type AttendancePageProps = {
  searchParams?: {
    month?: string;
    staffId?: string;
    day?: string;
  };
};

type DaySummary = {
  clockInJst: Date | null;
  clockOutJst: Date | null;
  workingMinutes: number;
};

function buildDaySummary(records: AttendanceRecord[]): DaySummary {
  if (records.length === 0) return { clockInJst: null, clockOutJst: null, workingMinutes: 0 };

  const events = records
    .map((record) => ({ ...record, jst: toJst(record.timestamp) }))
    .sort((a, b) => a.jst.getTime() - b.jst.getTime());

  const clockInEvent = events.find((e) => e.type === "CLOCK_IN");
  const clockOutEvent = [...events].reverse().find((e) => e.type === "CLOCK_OUT");

  let workingMinutes = 0;
  let currentStart: Date | null = null;
  let inBreak = false;

  for (const event of events) {
    switch (event.type) {
      case "CLOCK_IN": {
        currentStart = event.jst;
        inBreak = false;
        break;
      }
      case "BREAK_START": {
        if (currentStart && !inBreak) {
          workingMinutes += differenceInMinutes(event.jst, currentStart);
          currentStart = null;
        }
        inBreak = true;
        break;
      }
      case "BREAK_END": {
        if (inBreak) {
          currentStart = event.jst;
          inBreak = false;
        }
        break;
      }
      case "CLOCK_OUT": {
        if (currentStart && !inBreak) {
          workingMinutes += differenceInMinutes(event.jst, currentStart);
          currentStart = null;
        }
        break;
      }
      default:
        break;
    }
  }

  return { clockInJst: clockInEvent?.jst ?? null, clockOutJst: clockOutEvent?.jst ?? null, workingMinutes };
}

function isYyyyMm(value: string | null | undefined) {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

function isYyyyMmDd(value: string | null | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function nextMonthYyyyMm(yyyyMm: string) {
  const [y, m] = yyyyMm.split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  const ny = d.getUTCFullYear();
  const nm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${ny}-${nm}`;
}

function parseJstMonthRangeUtc(monthYyyyMm: string) {
  // JST月初(00:00+09:00) を UTC Date にする
  const from = new Date(`${monthYyyyMm}-01T00:00:00+09:00`);
  const to = new Date(`${nextMonthYyyyMm(monthYyyyMm)}-01T00:00:00+09:00`); // 翌月月初(JST)
  return { from, to };
}

function parseSelectedDayJstStart(dayYmd: string) {
  // JSTの 00:00 を “JSTとしての壁時計Date” に寄せる
  const baseUtc = new Date(`${dayYmd}T00:00:00+09:00`);
  return startOfDay(toJst(baseUtc));
}

async function safeFetchAttendances(params: Prisma.AttendanceFindManyArgs): Promise<AttendanceRecord[]> {
  try {
    return (await prisma.attendance.findMany(params)) as AttendanceRecord[];
  } catch (error) {
    console.error("[attendance] fetch failed", error);
    return [] as AttendanceRecord[];
  }
}

async function safeFetchApprovals(params: Prisma.AttendanceApprovalFindManyArgs) {
  try {
    return await prisma.attendanceApproval.findMany(params);
  } catch (error) {
    console.error("[attendance] approval fetch failed", error);
    return [] as AttendanceApprovalRecord[];
  }
}

async function deleteAttendance(formData: FormData) {
  "use server";
  const session = await getCurrentSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) throw new Error("Unauthorized");

  const attendanceId = formData.get("attendanceId");
  const returnTo = formData.get("returnTo");

  if (!attendanceId || typeof attendanceId !== "string") throw new Error("勤怠IDが不明です");

  await prisma.attendance.delete({ where: { id: attendanceId } });

  revalidatePath("/dashboard/attendance");
  if (typeof returnTo === "string" && returnTo) redirect(returnTo);
}

async function updateAttendance(formData: FormData) {
  "use server";
  const session = await getCurrentSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) throw new Error("Unauthorized");

  const attendanceId = formData.get("attendanceId");
  const timestamp = formData.get("timestamp");
  const returnTo = formData.get("returnTo");

  if (!attendanceId || typeof attendanceId !== "string") throw new Error("勤怠IDが不明です");
  if (!timestamp || typeof timestamp !== "string") throw new Error("日時を指定してください");

  const parsed = new Date(`${timestamp}:00+09:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error("日時の形式が不正です");

  await prisma.attendance.update({
    where: { id: attendanceId },
    data: { timestamp: parsed },
  });

  revalidatePath("/dashboard/attendance");
  if (typeof returnTo === "string" && returnTo) redirect(returnTo);
}

async function upsertClockEvent(formData: FormData) {
  "use server";
  const session = await getCurrentSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) throw new Error("Unauthorized");

  const attendanceId = formData.get("attendanceId");
  const staffId = formData.get("staffId");
  const type = formData.get("type");
  const timestamp = formData.get("timestamp");
  const isCompanion = formData.get("isCompanion");
  const returnTo = formData.get("returnTo");

  if (!staffId || typeof staffId !== "string") throw new Error("スタッフIDが不明です");
  if (!type || typeof type !== "string") throw new Error("種別が不明です");
  if (!timestamp || typeof timestamp !== "string") throw new Error("日時を指定してください");
  if (!["CLOCK_IN", "CLOCK_OUT"].includes(type)) throw new Error("出勤/退勤のみ編集可能です");

  const parsed = new Date(`${timestamp}:00+09:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error("日時の形式が不正です");

  const defaultStore = await getOrCreateDefaultStore();
  const storeId = session.user.storeId ?? defaultStore.id;

  const staff = await prisma.user.findFirst({ where: { id: staffId, storeId } });
  if (!staff) throw new Error("対象スタッフが見つかりません");

  // ✅ 同伴は CLOCK_IN のみに適用
  const companion = type === "CLOCK_IN" ? isCompanion === "on" : false;

  const idStr = typeof attendanceId === "string" ? attendanceId : "";
  const shouldCreate = !idStr || idStr.startsWith("new-");

  if (shouldCreate) {
    await prisma.attendance.create({
      data: {
        storeId,
        userId: staffId,
        type: type as AttendanceRecord["type"],
        timestamp: parsed,
        isCompanion: companion,
      },
    });
  } else {
    await prisma.attendance.update({
      where: { id: idStr },
      data: { timestamp: parsed, isCompanion: companion },
    });
  }

  revalidatePath("/dashboard/attendance");
  if (typeof returnTo === "string" && returnTo) redirect(returnTo);
}

async function createOwnerAttendance(formData: FormData) {
  "use server";
  const session = await getCurrentSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) throw new Error("Unauthorized");

  const staffId = formData.get("staffId");
  const clockIn = formData.get("clockIn");
  const clockOut = formData.get("clockOut");
  const isCompanion = formData.get("isCompanion");
  const returnTo = formData.get("returnTo");

  if (!staffId || typeof staffId !== "string") throw new Error("スタッフを選択してください");
  if (!clockIn || typeof clockIn !== "string") throw new Error("出勤時刻を指定してください");
  if (!clockOut || typeof clockOut !== "string") throw new Error("退勤時刻を指定してください");

  const inParsed = new Date(`${clockIn}:00+09:00`);
  const outParsed = new Date(`${clockOut}:00+09:00`);
  if (Number.isNaN(inParsed.getTime()) || Number.isNaN(outParsed.getTime())) throw new Error("日時の形式が不正です");

  const defaultStore = await getOrCreateDefaultStore();
  const storeId = session.user.storeId ?? defaultStore.id;

  const staff = await prisma.user.findFirst({ where: { id: staffId, storeId } });
  if (!staff) throw new Error("対象スタッフが見つかりません");

  // ✅ 同伴は CLOCK_IN のみに適用
  const companion = isCompanion === "on";

  await prisma.attendance.createMany({
    data: [
      { storeId, userId: staffId, type: "CLOCK_IN", timestamp: inParsed, isCompanion: companion },
      { storeId, userId: staffId, type: "CLOCK_OUT", timestamp: outParsed, isCompanion: false },
    ],
  });

  revalidatePath("/dashboard/attendance");
  if (typeof returnTo === "string" && returnTo) redirect(returnTo);
}

async function approveDay(formData: FormData) {
  "use server";
  const session = await getCurrentSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) throw new Error("Unauthorized");

  const dateValue = formData.get("date");
  const returnTo = formData.get("returnTo");
  if (!dateValue || typeof dateValue !== "string") throw new Error("日付が不明です");

  const defaultStore = await getOrCreateDefaultStore();
  await updateDayApproval({
    storeId: session.user.storeId ?? defaultStore.id,
    date: new Date(dateValue),
    approved: true,
    approverId: session.user.id,
  });

  revalidatePath("/dashboard/attendance");
  if (typeof returnTo === "string" && returnTo) redirect(returnTo);
}

async function unapproveDay(formData: FormData) {
  "use server";
  const session = await getCurrentSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) throw new Error("Unauthorized");

  const dateValue = formData.get("date");
  const returnTo = formData.get("returnTo");
  if (!dateValue || typeof dateValue !== "string") throw new Error("日付が不明です");

  const defaultStore = await getOrCreateDefaultStore();
  await updateDayApproval({
    storeId: session.user.storeId ?? defaultStore.id,
    date: new Date(dateValue),
    approved: false,
    approverId: session.user.id,
  });

  revalidatePath("/dashboard/attendance");
  if (typeof returnTo === "string" && returnTo) redirect(returnTo);
}

export default async function AttendancePage({ searchParams }: AttendancePageProps) {
  const session = await getCurrentSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) redirect("/dashboard");

  const defaultStore = await getOrCreateDefaultStore();
  const activeStoreId = session.user.storeId ?? defaultStore.id;

  // 写真のpruneは “ページ表示を壊さない” ように、失敗しても継続
  try {
    await pruneOldAttendancePhotos();
  } catch (e) {
    console.warn("[attendance] pruneOldAttendancePhotos skipped", e);
  }

  try {
    const monthParam = searchParams?.month;
    const monthYyyyMm = isYyyyMm(monthParam) ? monthParam! : format(toJst(new Date()), "yyyy-MM");

    const { from: monthFromUtc, to: monthToUtc } = parseJstMonthRangeUtc(monthYyyyMm);
    const monthStartJst = startOfDay(toJst(monthFromUtc));
    const monthEndJst = addDays(startOfDay(toJst(monthToUtc)), -1);

    const staffList = await prisma.user.findMany({
      where: { role: { in: ["CAST", "DRIVER"] }, isActive: true, storeId: activeStoreId },
      orderBy: { displayName: "asc" },
    });

    const staffFilterParam = searchParams?.staffId;
    const selectedStaffId =
      staffFilterParam && staffFilterParam !== "__all__" && staffList.some((staff) => staff.id === staffFilterParam)
        ? staffFilterParam
        : undefined;

    const staffSelectValue = selectedStaffId ?? "__all__";

    const attendances = await safeFetchAttendances({
      where: {
        storeId: activeStoreId,
        timestamp: { gte: monthFromUtc, lt: monthToUtc },
        ...(selectedStaffId ? { userId: selectedStaffId } : {}),
      },
      include: { user: true, approvedBy: true }, // ✅ photoは別クエリで取る
      orderBy: { timestamp: "asc" },
    });

    // ✅ 写真は attendanceId で確実に引く
    const attendanceIds = attendances.map((a) => a.id);
    const photos = attendanceIds.length
      ? await prisma.attendancePhoto.findMany({
          where: { storeId: activeStoreId, attendanceId: { in: attendanceIds } },
          select: { attendanceId: true, photoUrl: true },
        })
      : [];

    const photoByAttendanceId = photos.reduce<Record<string, string>>((acc, p) => {
      acc[p.attendanceId] = p.photoUrl;
      return acc;
    }, {});

    const approvals = await safeFetchApprovals({
      where: {
        storeId: activeStoreId,
        date: { gte: monthFromUtc, lt: monthToUtc },
      },
    });

    const calendarDays = eachDayOfInterval({ start: monthStartJst, end: monthEndJst });

    const attendanceByDate = attendances.reduce<Record<string, AttendanceRecord[]>>((acc, record) => {
      const key = format(toJst(record.timestamp), "yyyy-MM-dd"); // ✅ JSTで日付キー化
      acc[key] = acc[key] ? [...acc[key], record] : [record];
      return acc;
    }, {});

    const approvalByDate = approvals.reduce<Record<string, boolean>>((acc, approval) => {
      const key = format(toJst(approval.date), "yyyy-MM-dd"); // ✅ JSTで日付キー化
      acc[key] = approval.isApproved;
      return acc;
    }, {});

    const selectedDayParam = searchParams?.day;
    const selectedDay =
      isYyyyMmDd(selectedDayParam) && isValid(new Date(selectedDayParam!))
        ? parseSelectedDayJstStart(selectedDayParam!)
        : startOfDay(monthStartJst);

    const selectedDayKey = format(selectedDay, "yyyy-MM-dd");
    const selectedDayAttendances = attendanceByDate[selectedDayKey] ?? [];
    const hasSelectedDayRecords = selectedDayAttendances.length > 0;

    const groupedByStaff = selectedDayAttendances.reduce<
      Record<
        string,
        { staffName: string; records: AttendanceRecord[]; isApproved: boolean; isOwnerCreated: boolean; companion: boolean; clockInPhotoUrl?: string }
      >
    >((acc, record) => {
      const key = record.userId;
      const existing = acc[key];

      const updatedRecords = existing ? [...existing.records, record] : [record];
      const sorted = updatedRecords.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      const clockIn = sorted.find((r) => r.type === "CLOCK_IN") ?? null;
      const clockInPhotoUrl = clockIn ? photoByAttendanceId[clockIn.id] : undefined;

      // ✅ CLOCK_INに写真が無い = オーナー作成（写真なし）扱い
      const isOwnerCreated = Boolean(clockIn) && !clockInPhotoUrl;

      const companion = Boolean(clockIn?.isCompanion);

      acc[key] = {
        staffName: record.user.displayName,
        records: sorted,
        isApproved: sorted.every((r) => Boolean(r.approvedAt)),
        isOwnerCreated,
        companion,
        clockInPhotoUrl,
      };
      return acc;
    }, {});

    const selectedDayApproved =
      approvalByDate[selectedDayKey] ??
      (selectedDayAttendances.length > 0 && selectedDayAttendances.every((attendance) => Boolean(attendance.approvedAt)));

    const monthlySummary = await getMonthlyAttendanceSummary({
      storeId: activeStoreId,
      staffId: selectedStaffId,
      year: Number(format(monthStartJst, "yyyy")),
      month: Number(format(monthStartJst, "M")),
    });

    const monthlyCompanionCount =
      selectedStaffId ? attendances.filter((a) => a.type === "CLOCK_IN" && a.isCompanion).length : 0;

    const workingHoursLabel =
      staffSelectValue === "__all__"
        ? "勤務時間合計（全員）"
        : `勤務時間合計（${staffList.find((s) => s.id === staffSelectValue)?.displayName ?? "スタッフ"}）`;

    // ✅ ネイティブのカレンダー/時計アイコンをダーク対応にする
    const dateTimeInputClass = "md:w-64 [color-scheme:dark]";
    const monthInputClass = "[color-scheme:dark]";
    const nativeSelectClass =
      "h-10 w-full rounded-md border border-slate-800 bg-slate-950/50 px-3 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-pink-500/40";

    const returnTo = `/dashboard/attendance?month=${monthYyyyMm}&staffId=${staffSelectValue}&day=${selectedDayKey}`;

    return (
      <div className="space-y-8">
        <h1 className="text-2xl font-semibold text-pink-300">勤怠管理</h1>

        <Card>
          <CardHeader>
            <CardTitle>フィルター</CardTitle>
            <CardDescription>{defaultStore.name} の勤怠を月単位で確認します。</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-3 sm:items-end" method="get">
              <div className="space-y-2">
                <Label htmlFor="month">月</Label>
                <Input id="month" name="month" type="month" defaultValue={monthYyyyMm} className={monthInputClass} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="staffId">スタッフ</Label>
                <select id="staffId" name="staffId" defaultValue={staffSelectValue} className={nativeSelectClass}>
                  <option value="__all__">全員</option>
                  {staffList.map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end">
                <Button type="submit" size="sm" className="min-w-[96px]">
                  表示
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{workingHoursLabel}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end justify-between gap-3">
            <div className="text-3xl font-bold text-pink-300">
              {monthlySummary.roundedHours} 時間 {monthlySummary.roundedRemainderMinutes} 分
            </div>

            {selectedStaffId ? (
              <div className="rounded-full border border-slate-700/60 bg-black/30 px-3 py-1 text-sm text-slate-200">
                同伴：{monthlyCompanionCount} 回
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>{format(selectedDay, "yyyy-MM-dd (E)", { locale: ja })} の勤怠詳細</CardTitle>
              <CardDescription>
                {selectedDayApproved
                  ? "承認済みです（※編集・削除の制限はありません）"
                  : "未承認です（※編集・削除の制限はありません）"}
              </CardDescription>
            </div>

            {hasSelectedDayRecords ? (
              <div className="flex gap-2">
                {selectedDayApproved ? (
                  <form action={unapproveDay}>
                    <input type="hidden" name="date" value={selectedDay.toISOString()} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <Button type="submit" variant="secondary" size="sm">
                      承認取消
                    </Button>
                  </form>
                ) : (
                  <form action={approveDay}>
                    <input type="hidden" name="date" value={selectedDay.toISOString()} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <Button type="submit" size="sm">
                      承認
                    </Button>
                  </form>
                )}
              </div>
            ) : null}
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="rounded-lg border border-slate-800/60 bg-black/30 p-4">
              <p className="text-sm font-semibold text-slate-100">勤務データを作成（オーナー作成：写真なし）</p>
              <p className="mt-1 text-xs text-slate-400">
                データが無い日でも、既にデータがある日でも作成できます。重複した場合は下の「削除」で個別に整理できます。
              </p>

              <form action={createOwnerAttendance} className="mt-4 grid gap-3 lg:grid-cols-5 lg:items-end">
                <input type="hidden" name="returnTo" value={returnTo} />

                <div className="space-y-2 lg:col-span-2">
                  <Label className="text-xs text-slate-400">スタッフ</Label>
                  <select
                    name="staffId"
                    defaultValue={selectedStaffId ?? (staffList[0]?.id ?? "")}
                    className={nativeSelectClass}
                    required
                  >
                    {staffList.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.displayName}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-slate-400">出勤</Label>
                  <Input type="datetime-local" name="clockIn" required className={dateTimeInputClass} />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-slate-400">退勤</Label>
                  <Input type="datetime-local" name="clockOut" required className={dateTimeInputClass} />
                </div>

                <div className="flex items-center justify-between gap-3 lg:justify-end">
                  <div className="flex items-center gap-2 pt-1 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      id="owner-create-companion"
                      name="isCompanion"
                      className="h-4 w-4 rounded border border-slate-700 bg-black text-pink-400 focus-visible:outline-none"
                    />
                    <Label htmlFor="owner-create-companion">同伴（出勤のみ）</Label>
                  </div>

                  <Button type="submit" size="sm" className="min-w-[88px]">
                    保存
                  </Button>
                </div>
              </form>
            </div>

            {selectedDayAttendances.length === 0 ? (
              <p className="text-sm text-slate-400">勤怠記録がありません。</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {Object.entries(groupedByStaff).map(([staffId, group]) => {
                  const summary = buildDaySummary(group.records);

                  const clockInRecord = group.records.find((r) => r.type === "CLOCK_IN") ?? null;
                  const clockOutRecord = [...group.records].reverse().find((r) => r.type === "CLOCK_OUT") ?? null;

                  return (
                    <li key={staffId} className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                          <div>
                            <p className="text-base font-semibold text-pink-200">{group.staffName}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <p className="text-xs text-slate-400">{group.isApproved ? "承認済み" : "未承認"}</p>

                              {group.isOwnerCreated ? (
                                <span className="rounded-full bg-slate-800/70 px-2 py-1 text-[11px] text-slate-200">
                                  オーナー作成（写真なし）
                                </span>
                              ) : null}

                              {group.companion ? (
                                <span className="rounded-full bg-pink-900/40 px-2 py-1 text-[11px] text-pink-200">
                                  同伴（出勤）
                                </span>
                              ) : null}
                            </div>
                          </div>

                          {/* ✅ 出勤写真表示（端末打刻のみ） */}
                          {group.clockInPhotoUrl ? (
                            <a
                              href={group.clockInPhotoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="block w-fit rounded-lg border border-slate-800/60 bg-black/40 p-2"
                            >
                              <img
                                src={group.clockInPhotoUrl}
                                alt="出勤写真"
                                className="h-32 w-32 rounded-md object-cover"
                                loading="lazy"
                              />
                              <p className="mt-1 text-[11px] text-slate-400">出勤写真（クリックで拡大）</p>
                            </a>
                          ) : null}
                        </div>

                        <div className="text-right text-xs text-slate-400">
                          出勤時間：{summary.clockInJst ? format(summary.clockInJst, "HH:mm") : "—"}
                          <br />
                          退勤時間：{summary.clockOutJst ? format(summary.clockOutJst, "HH:mm") : "未退勤"}
                          <br />
                          結果：{`${Math.floor(summary.workingMinutes / 60)}時間${summary.workingMinutes % 60}分`}
                        </div>
                      </div>

                      <details className="rounded-lg border border-slate-800/60 bg-black/40 p-3">
                        <summary className="cursor-pointer text-xs text-slate-400">
                          詳細を開く（出勤/退勤の作成・編集 / 個別打刻・休憩編集）
                        </summary>

                        <div className="mt-3 space-y-3">
                          {/* 出勤（CLOCK_IN） */}
                          <div className="space-y-2 rounded-md border border-slate-800/70 bg-slate-950/50 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs text-slate-300">出勤（CLOCK_IN）</p>
                              {clockInRecord ? (
                                <form action={deleteAttendance}>
                                  <input type="hidden" name="attendanceId" value={clockInRecord.id} />
                                  <input type="hidden" name="returnTo" value={returnTo} />
                                  <Button type="submit" size="sm" variant="destructive">
                                    削除
                                  </Button>
                                </form>
                              ) : null}
                            </div>

                            <form action={upsertClockEvent} className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
                              <input type="hidden" name="returnTo" value={returnTo} />
                              <input type="hidden" name="attendanceId" value={clockInRecord ? clockInRecord.id : "new-CLOCK_IN"} />
                              <input type="hidden" name="staffId" value={staffId} />
                              <input type="hidden" name="type" value="CLOCK_IN" />

                              <div className="space-y-1">
                                <Label className="text-xs text-slate-400">時刻</Label>
                                <Input
                                  type="datetime-local"
                                  name="timestamp"
                                  required
                                  defaultValue={clockInRecord ? format(toJst(clockInRecord.timestamp), "yyyy-MM-dd'T'HH:mm") : ""}
                                  className={dateTimeInputClass}
                                />
                              </div>

                              <div className="flex items-center gap-2 pt-5 text-xs text-slate-200">
                                <input
                                  type="checkbox"
                                  id={`clockin-companion-${staffId}`}
                                  name="isCompanion"
                                  defaultChecked={clockInRecord?.isCompanion ?? false}
                                  className="h-4 w-4 rounded border border-slate-700 bg-black text-pink-400 focus-visible:outline-none"
                                />
                                <Label htmlFor={`clockin-companion-${staffId}`}>同伴</Label>
                              </div>

                              <Button type="submit" size="sm" variant="secondary" className="md:mt-5">
                                更新
                              </Button>
                            </form>
                          </div>

                          {/* 退勤（CLOCK_OUT） */}
                          <div className="space-y-2 rounded-md border border-slate-800/70 bg-slate-950/50 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs text-slate-300">退勤（CLOCK_OUT）</p>
                              {clockOutRecord ? (
                                <form action={deleteAttendance}>
                                  <input type="hidden" name="attendanceId" value={clockOutRecord.id} />
                                  <input type="hidden" name="returnTo" value={returnTo} />
                                  <Button type="submit" size="sm" variant="destructive">
                                    削除
                                  </Button>
                                </form>
                              ) : null}
                            </div>

                            <form action={upsertClockEvent} className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
                              <input type="hidden" name="returnTo" value={returnTo} />
                              <input type="hidden" name="attendanceId" value={clockOutRecord ? clockOutRecord.id : "new-CLOCK_OUT"} />
                              <input type="hidden" name="staffId" value={staffId} />
                              <input type="hidden" name="type" value="CLOCK_OUT" />

                              <div className="space-y-1">
                                <Label className="text-xs text-slate-400">時刻</Label>
                                <Input
                                  type="datetime-local"
                                  name="timestamp"
                                  required
                                  defaultValue={clockOutRecord ? format(toJst(clockOutRecord.timestamp), "yyyy-MM-dd'T'HH:mm") : ""}
                                  className={dateTimeInputClass}
                                />
                              </div>

                              <Button type="submit" size="sm" variant="secondary" className="md:mt-5">
                                更新
                              </Button>
                            </form>
                          </div>

                          {/* 休憩など */}
                          {group.records.filter((r) => !["CLOCK_IN", "CLOCK_OUT"].includes(r.type)).length === 0 ? (
                            <p className="text-xs text-slate-500">休憩などの追加レコードはありません。</p>
                          ) : (
                            group.records
                              .filter((r) => !["CLOCK_IN", "CLOCK_OUT"].includes(r.type))
                              .map((attendance) => {
                                const jstTimestamp = toJst(attendance.timestamp);
                                return (
                                  <div key={attendance.id} className="space-y-2 rounded-md border border-slate-800/70 bg-slate-950/50 p-3">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                      <div>
                                        <p className="text-xs text-slate-400">
                                          {format(jstTimestamp, "HH:mm", { locale: ja })} /{" "}
                                          {attendanceLabels[attendance.type] ?? attendance.type}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                          {attendance.approvedAt
                                            ? `承認済 (${format(toJst(attendance.approvedAt), "MM/dd HH:mm")})`
                                            : "未承認"}
                                        </p>
                                      </div>

                                      <form action={deleteAttendance}>
                                        <input type="hidden" name="attendanceId" value={attendance.id} />
                                        <input type="hidden" name="returnTo" value={returnTo} />
                                        <Button type="submit" size="sm" variant="destructive">
                                          削除
                                        </Button>
                                      </form>
                                    </div>

                                    <form action={updateAttendance} className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
                                      <input type="hidden" name="attendanceId" value={attendance.id} />
                                      <input type="hidden" name="returnTo" value={returnTo} />

                                      <div className="space-y-1">
                                        <Label className="text-xs text-slate-400">時刻</Label>
                                        <Input
                                          type="datetime-local"
                                          name="timestamp"
                                          defaultValue={format(jstTimestamp, "yyyy-MM-dd'T'HH:mm")}
                                          className={dateTimeInputClass}
                                        />
                                      </div>

                                      <Button type="submit" size="sm" variant="secondary" className="md:mt-5">
                                        更新
                                      </Button>
                                    </form>
                                  </div>
                                );
                              })
                          )}
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>月間カレンダー</CardTitle>
            <CardDescription>各日に出勤したスタッフを表示します。クリックで詳細を表示。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              {calendarDays.map((dayJst) => {
                const key = format(dayJst, "yyyy-MM-dd");
                const dayAttendances = attendanceByDate[key] ?? [];
                const uniqueNames = Array.from(new Set(dayAttendances.map((a) => a.user.displayName)));
                const approved = approvalByDate[key];
                const isSelected = key === selectedDayKey;

                return (
                  <Link
                    key={key}
                    href={`/dashboard/attendance?month=${monthYyyyMm}&staffId=${staffSelectValue}&day=${key}`}
                    className="focus-visible:outline-none"
                  >
                    <div
                      className={`rounded-lg border bg-black/70 p-3 text-xs text-slate-200 transition-colors ${
                        isSelected ? "border-pink-500/60" : "border-slate-800"
                      }`}
                    >
                      <div className="flex items-baseline justify-between">
                        <p className="text-sm font-semibold text-pink-200">{format(dayJst, "M/d")}</p>
                        <p className="text-[11px] text-slate-500">{format(dayJst, "EEE", { locale: ja })}</p>
                      </div>

                      {approved ? (
                        <p className="mt-1 rounded-full bg-pink-900/50 px-2 py-1 text-[11px] text-pink-200">
                          承認済
                        </p>
                      ) : null}

                      <div className="mt-2 space-y-1">
                        {uniqueNames.length === 0 ? (
                          <p className="text-slate-600">出勤なし</p>
                        ) : (
                          uniqueNames.slice(0, 2).map((name) => <p key={name}>{name}</p>)
                        )}
                        {uniqueNames.length > 2 ? <p className="text-slate-500">+{uniqueNames.length - 2} 名</p> : null}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  } catch (error) {
    console.error("[attendance] render", error);
    return (
      <div className="rounded-lg border border-red-900/40 bg-red-950/30 p-6 text-sm text-red-100">
        勤怠データの読み込みに失敗しました。時間をおいて再度お試しください。
      </div>
    );
  }
}
