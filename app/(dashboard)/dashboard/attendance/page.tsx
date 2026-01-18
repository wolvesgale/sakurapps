import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  addDays,
  differenceInMinutes,
  eachDayOfInterval,
  endOfMonth,
  format,
  isValid,
  startOfDay,
  startOfMonth
} from "date-fns";
import { ja } from "date-fns/locale";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { getOrCreateDefaultStore } from "@/lib/store";
import { getAttendanceSummaryForRange, getMonthlyAttendanceSummary, updateDayApproval } from "@/lib/attendance";
import { pruneOldAttendancePhotos } from "@/lib/attendance-photo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const dynamic = "force-dynamic";

const attendanceLabels: Record<string, string> = {
  CLOCK_IN: "出勤",
  CLOCK_OUT: "退勤",
  BREAK_START: "休憩開始",
  BREAK_END: "休憩終了"
};

const TZ = "Asia/Tokyo";

const toJst = (date: Date) => new Date(date.toLocaleString("en-US", { timeZone: TZ }));

const parseJstDateParam = (value?: string) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

type AttendanceRecord = Prisma.AttendanceGetPayload<{ include: { user: true; approvedBy: true; photo: true } }>;
type AttendanceApprovalRecord = Prisma.AttendanceApprovalGetPayload<Record<string, never>>;

type AttendancePageProps = {
  searchParams?: {
    month?: string;
    staffId?: string;
    day?: string;
    startDate?: string;
    endDate?: string;
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

async function safeFetchAttendances(params: Prisma.AttendanceFindManyArgs): Promise<AttendanceRecord[]> {
  try {
    return (await prisma.attendance.findMany(params)) as AttendanceRecord[];
  } catch (error) {
    console.error("[attendance] primary fetch failed, retrying without photo include", error);
    const fallbackParams: Prisma.AttendanceFindManyArgs = { ...params };
    // omit photo include when schema/table is unavailable
    if (fallbackParams.include) {
      const restInclude = { ...(fallbackParams.include as Record<string, unknown>) };
      delete (restInclude as Record<string, unknown>).photo;
      fallbackParams.include = restInclude as Prisma.AttendanceFindManyArgs["include"];
    }
    try {
      return (await prisma.attendance.findMany(fallbackParams)) as AttendanceRecord[];
    } catch (secondaryError) {
      console.error("[attendance] fallback fetch failed", secondaryError);
      return [] as AttendanceRecord[];
    }
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

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    throw new Error("Unauthorized");
  }

  const attendanceId = formData.get("attendanceId");

  if (!attendanceId || typeof attendanceId !== "string") {
    throw new Error("勤怠IDが不明です");
  }

  await prisma.attendance.delete({ where: { id: attendanceId } });

  revalidatePath("/dashboard/attendance");
}

async function updateAttendance(formData: FormData) {
  "use server";
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    throw new Error("Unauthorized");
  }

  const attendanceId = formData.get("attendanceId");
  const timestamp = formData.get("timestamp");
  const isCompanion = formData.get("isCompanion");

  if (!attendanceId || typeof attendanceId !== "string") {
    throw new Error("勤怠IDが不明です");
  }

  if (!timestamp || typeof timestamp !== "string") {
    throw new Error("日時を指定してください");
  }

  await prisma.attendance.update({
    where: { id: attendanceId },
    data: { timestamp: new Date(timestamp), isCompanion: Boolean(isCompanion) }
  });

  revalidatePath("/dashboard/attendance");
}

async function approveDay(formData: FormData) {
  "use server";
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    throw new Error("Unauthorized");
  }

  const dateValue = formData.get("date");
  if (!dateValue || typeof dateValue !== "string") {
    throw new Error("日付が不明です");
  }

  const defaultStore = await getOrCreateDefaultStore();
  await updateDayApproval({
    storeId: session.user.storeId ?? defaultStore.id,
    date: new Date(dateValue),
    approved: true,
    approverId: session.user.id
  });

  revalidatePath("/dashboard/attendance");
}

async function unapproveDay(formData: FormData) {
  "use server";
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    throw new Error("Unauthorized");
  }

  const dateValue = formData.get("date");
  if (!dateValue || typeof dateValue !== "string") {
    throw new Error("日付が不明です");
  }

  const defaultStore = await getOrCreateDefaultStore();
  await updateDayApproval({
    storeId: session.user.storeId ?? defaultStore.id,
    date: new Date(dateValue),
    approved: false,
    approverId: session.user.id
  });

  revalidatePath("/dashboard/attendance");
}

export default async function AttendancePage({ searchParams }: AttendancePageProps) {
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  const defaultStore = await getOrCreateDefaultStore();
  const activeStoreId = session.user.storeId ?? defaultStore.id;

  try {
    await pruneOldAttendancePhotos();

    const monthParam = searchParams?.month;
    const parsedMonth =
      monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? new Date(`${monthParam}-01`) : new Date();
    const startDateParam = parseJstDateParam(searchParams?.startDate);
    const endDateParam = parseJstDateParam(searchParams?.endDate);
    const hasCustomRange = Boolean(startDateParam && endDateParam);
    const hasDateInputs = Boolean(startDateParam || endDateParam);
    const monthBase = hasCustomRange && startDateParam ? startDateParam : parsedMonth;
    const monthStart = startOfMonth(monthBase);
    const monthEnd = endOfMonth(monthStart);
    const rangeStart = hasCustomRange && startDateParam ? startOfDay(startDateParam) : monthStart;
    const rangeEnd =
      hasCustomRange && endDateParam ? addDays(startOfDay(endDateParam), 1) : addDays(monthEnd, 1);
    const staffList = await prisma.user.findMany({
      where: { role: { in: ["CAST", "DRIVER"] }, isActive: true, storeId: activeStoreId },
      orderBy: { displayName: "asc" }
    });

    const staffFilterParam = searchParams?.staffId;
    const selectedStaffId =
      staffFilterParam && staffFilterParam !== "__all__" && staffList.some((staff) => staff.id === staffFilterParam)
        ? staffFilterParam
        : undefined;

    const attendances = await safeFetchAttendances({
      where: {
        storeId: activeStoreId,
        timestamp: { gte: rangeStart, lt: rangeEnd },
        ...(selectedStaffId ? { userId: selectedStaffId } : {})
      },
      include: { user: true, approvedBy: true, photo: true },
      orderBy: { timestamp: "asc" }
    });

    const approvals = await safeFetchApprovals({
      where: {
        storeId: activeStoreId,
        date: { gte: startOfDay(rangeStart), lt: rangeEnd }
      }
    });

    const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const attendanceByDate = attendances.reduce<Record<string, AttendanceRecord[]>>((acc, record) => {
      const key = format(record.timestamp, "yyyy-MM-dd");
      acc[key] = acc[key] ? [...acc[key], record] : [record];
      return acc;
    }, {});

    const approvalByDate = approvals.reduce<Record<string, boolean>>((acc, approval) => {
      const key = format(approval.date, "yyyy-MM-dd");
      acc[key] = approval.isApproved;
      return acc;
    }, {});

    const totalRecords = attendances.length;
    const staffSelectValue = selectedStaffId ?? "__all__";
    const selectedDayParam = searchParams?.day;
    const selectedDay =
      selectedDayParam && isValid(new Date(selectedDayParam))
        ? startOfDay(new Date(selectedDayParam))
        : startOfDay(hasCustomRange ? rangeStart : monthStart);
    const selectedDayKey = format(selectedDay, "yyyy-MM-dd");
    const selectedDayAttendances = attendanceByDate[selectedDayKey] ?? [];
    const hasSelectedDayRecords = selectedDayAttendances.length > 0;

    const groupedByStaff = selectedDayAttendances.reduce<
      Record<string, { staffName: string; records: AttendanceRecord[]; isApproved: boolean }>
    >((acc, record) => {
      const key = record.userId;
      const existing = acc[key];
      const updatedRecords = existing ? [...existing.records, record] : [record];
      acc[key] = {
        staffName: record.user.displayName,
        records: updatedRecords.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
        isApproved: updatedRecords.every((r) => Boolean(r.approvedAt))
      };
      return acc;
    }, {});

    const selectedDayApproved =
      approvalByDate[selectedDayKey] ??
      (selectedDayAttendances.length > 0 && selectedDayAttendances.every((attendance) => Boolean(attendance.approvedAt)));

    const summaryForPeriod = hasCustomRange
      ? await getAttendanceSummaryForRange({
          storeId: activeStoreId,
          staffId: selectedStaffId,
          startDate: rangeStart,
          endDate: rangeEnd
        })
      : await getMonthlyAttendanceSummary({
          storeId: activeStoreId,
          staffId: selectedStaffId,
          year: monthStart.getFullYear(),
          month: monthStart.getMonth() + 1
        });
    const staffLabel =
      staffSelectValue === "__all__"
        ? "全員"
        : staffList.find((s) => s.id === staffSelectValue)?.displayName ?? "スタッフ";
    const rangeLabel = hasCustomRange
      ? `勤務時間合計（${format(rangeStart, "yyyy-MM-dd")}〜${format(addDays(rangeEnd, -1), "yyyy-MM-dd")} / ${staffLabel}）`
      : staffSelectValue === "__all__"
        ? "勤務時間合計（全員）"
        : `勤務時間合計（${staffLabel}）`;

    return (
      <div className="space-y-8">
        <h1 className="text-2xl font-semibold text-pink-300">勤怠管理</h1>

        <Card>
          <CardHeader>
            <CardTitle>フィルター</CardTitle>
            <CardDescription>{defaultStore.name} の勤怠を月単位で確認します。</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-5" method="get">
              <div className="space-y-2">
                <Label htmlFor="month">月</Label>
                <Input
                  id="month"
                  name="month"
                  type="month"
                  defaultValue={format(monthStart, "yyyy-MM")}
                  disabled={hasDateInputs}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="startDate">開始日</Label>
                <Input
                  id="startDate"
                  name="startDate"
                  type="date"
                  defaultValue={startDateParam ? format(startDateParam, "yyyy-MM-dd") : ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">終了日</Label>
                <Input
                  id="endDate"
                  name="endDate"
                  type="date"
                  defaultValue={endDateParam ? format(endDateParam, "yyyy-MM-dd") : ""}
                />
              </div>
              <div className="space-y-2">
                <Label>スタッフ</Label>
                <Select name="staffId" defaultValue={staffSelectValue}>
                  <SelectTrigger>
                    <SelectValue placeholder="全員" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">全員</SelectItem>
                    {staffList.map((staff) => (
                      <SelectItem key={staff.id} value={staff.id}>
                        {staff.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button type="submit" size="sm">
                  表示
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>{rangeLabel}</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold text-pink-300">
              {summaryForPeriod.roundedHours} 時間 {summaryForPeriod.roundedRemainderMinutes} 分
              <p className="mt-2 text-sm font-medium text-slate-300">記録件数: {totalRecords} 件</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>月間カレンダー</CardTitle>
            <CardDescription>各日に出勤したスタッフを表示します。クリックで詳細を表示。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              {calendarDays.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const dayAttendances = attendanceByDate[key] ?? [];
                const uniqueNames = Array.from(new Set(dayAttendances.map((a) => a.user.displayName)));
                const approved = approvalByDate[key];
                const isSelected = key === selectedDayKey;

                const calendarParams = new URLSearchParams();
                calendarParams.set("month", format(monthStart, "yyyy-MM"));
                calendarParams.set("staffId", staffSelectValue);
                calendarParams.set("day", key);
                if (hasCustomRange && startDateParam && endDateParam) {
                  calendarParams.set("startDate", format(startDateParam, "yyyy-MM-dd"));
                  calendarParams.set("endDate", format(endDateParam, "yyyy-MM-dd"));
                }

                return (
                  <Link
                    key={key}
                    href={`/dashboard/attendance?${calendarParams.toString()}`}
                    className="focus-visible:outline-none"
                  >
                    <div
                      className={`rounded-lg border bg-black/70 p-3 text-xs text-slate-200 transition-colors ${
                        isSelected ? "border-pink-500/60" : "border-slate-800"
                      }`}
                    >
                      <div className="flex items-baseline justify-between">
                        <p className="text-sm font-semibold text-pink-200">{format(day, "M/d")}</p>
                        <p className="text-[11px] text-slate-500">{format(day, "EEE", { locale: ja })}</p>
                      </div>
                      {approved ? (
                        <p className="mt-1 rounded-full bg-pink-900/50 px-2 py-1 text-[11px] text-pink-200">承認済</p>
                      ) : null}
                      <div className="mt-2 space-y-1">
                        {uniqueNames.length === 0 ? (
                          <p className="text-slate-600">出勤なし</p>
                        ) : (
                          uniqueNames.slice(0, 2).map((name) => <p key={name}>{name}</p>)
                        )}
                        {uniqueNames.length > 2 ? (
                          <p className="text-slate-500">+{uniqueNames.length - 2} 名</p>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>{format(selectedDay, "yyyy-MM-dd (E)", { locale: ja })} の勤怠詳細</CardTitle>
              <CardDescription>
                {selectedDayApproved ? "承認済みです" : "未承認です。必要に応じて承認してください。"}
              </CardDescription>
            </div>
            {hasSelectedDayRecords ? (
              <div className="flex gap-2">
                {selectedDayApproved ? (
                  <form action={unapproveDay}>
                    <input type="hidden" name="date" value={selectedDay.toISOString()} />
                    <Button type="submit" variant="secondary" size="sm">
                      承認取消
                    </Button>
                  </form>
                ) : (
                  <form action={approveDay}>
                    <input type="hidden" name="date" value={selectedDay.toISOString()} />
                    <Button type="submit" size="sm">
                      承認
                    </Button>
                  </form>
                )}
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedDayAttendances.length === 0 ? (
              <p className="text-sm text-slate-400">勤怠記録がありません。</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {Object.entries(groupedByStaff).map(([staffId, group]) => {
                  const summary = buildDaySummary(group.records);
                  const approvedLabel = group.isApproved ? "承認済み" : "未承認";
                  const clockInPhotos = group.records.filter(
                    (record) => record.type === "CLOCK_IN" && record.photo
                  );

                  return (
                    <li key={staffId} className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-base font-semibold text-pink-200">{group.staffName}</p>
                          <p className="text-xs text-slate-400">{approvedLabel}</p>
                        </div>
                        <div className="text-right text-xs text-slate-400">
                          出勤時間：
                          {summary.clockInJst ? format(summary.clockInJst, "HH:mm") : "—"}
                          <br />
                          退勤時間：
                          {summary.clockOutJst ? format(summary.clockOutJst, "HH:mm") : "未退勤"}
                          <br />
                          結果：
                          {`${Math.floor(summary.workingMinutes / 60)}時間${summary.workingMinutes % 60}分`}
                        </div>
                      </div>

                      {clockInPhotos.length > 0 ? (
                        <div className="rounded-lg border border-slate-800/70 bg-black/30 p-3">
                          <p className="text-xs text-slate-300">出勤写真</p>
                          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                            {clockInPhotos.map((record) => (
                              <a
                                key={record.id}
                                href={record.photo?.photoUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="group overflow-hidden rounded-lg border border-slate-800/60 bg-slate-950/40"
                              >
                                {record.photo?.photoUrl ? (
                                  <img
                                    src={record.photo.photoUrl}
                                    alt={`${group.staffName} 出勤時の写真`}
                                    className="h-32 w-full object-cover transition duration-200 group-hover:opacity-90"
                                  />
                                ) : null}
                                <p className="px-2 py-1 text-[11px] text-slate-300">
                                  {format(toJst(record.timestamp), "HH:mm", { locale: ja })}
                                </p>
                              </a>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <details className="rounded-lg border border-slate-800/60 bg-black/40 p-3">
                        <summary className="cursor-pointer text-xs text-slate-400">詳細を開く（個別の打刻・休憩・同伴編集）</summary>
                        <div className="mt-3 space-y-3">
                          {group.records.map((attendance) => {
                            const jstTimestamp = toJst(attendance.timestamp);

                            return (
                              <div key={attendance.id} className="space-y-2 rounded-md border border-slate-800/70 bg-slate-950/50 p-3">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <div>
                                    <p className="text-xs text-slate-400">
                                      {format(jstTimestamp, "HH:mm", { locale: ja })} / {" "}
                                      {attendanceLabels[attendance.type] ?? attendance.type}
                                    </p>
                                    <p className="text-xs text-slate-400">同伴: {attendance.isCompanion ? "はい" : "いいえ"}</p>
                                    <p className="text-xs text-slate-500">
                                      {attendance.approvedAt
                                        ? `承認済 (${format(toJst(attendance.approvedAt), "MM/dd HH:mm")})`
                                        : "未承認"}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <form action={deleteAttendance}>
                                      <input type="hidden" name="attendanceId" value={attendance.id} />
                                      <Button type="submit" size="sm" variant="destructive">
                                        削除
                                      </Button>
                                    </form>
                                  </div>
                                </div>
                                <form action={updateAttendance} className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
                                  <input type="hidden" name="attendanceId" value={attendance.id} />
                                  <div className="space-y-1">
                                    <Label className="text-xs text-slate-400">時刻</Label>
                                    <Input
                                      type="datetime-local"
                                      name="timestamp"
                                      defaultValue={format(jstTimestamp, "yyyy-MM-dd'T'HH:mm")}
                                      className="md:w-64"
                                    />
                                  </div>
                                  <div className="flex items-center gap-2 pt-5 text-xs text-slate-200">
                                    <input
                                      type="checkbox"
                                      id={`companion-${attendance.id}`}
                                      name="isCompanion"
                                      defaultChecked={attendance.isCompanion}
                                      className="h-4 w-4 rounded border border-slate-700 bg-black text-pink-400 focus-visible:outline-none"
                                    />
                                    <Label htmlFor={`companion-${attendance.id}`}>同伴</Label>
                                  </div>
                                  <Button type="submit" size="sm" variant="secondary" className="md:mt-5">
                                    更新
                                  </Button>
                                </form>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}

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
