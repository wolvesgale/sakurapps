// app/(dashboard)/dashboard/attendance/page.tsx

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
  startOfMonth,
  subMonths,
} from "date-fns";
import { ja } from "date-fns/locale";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOrCreateDefaultStore } from "@/lib/store";
import { updateDayApproval } from "@/lib/attendance";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SearchParams = {
  month?: string;
  staffId?: string;
  day?: string;
};

type AttendanceWithUser = Prisma.AttendanceGetPayload<{
  include: { user: { select: { id: true; displayName: true } } };
}>;

type ApprovalState = {
  dateKey: string;
  isApproved: boolean;
  approvedAt: Date | null;
  approvedById: string | null;
};

type ServerUser = Record<string, unknown> & {
  id?: string;
  userId?: string;
};

type UnknownFn = () => Promise<unknown> | unknown;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

async function getServerUserCompat(): Promise<ServerUser | null> {
  try {
    const mod = (await import("@/lib/auth")) as Record<string, unknown>;

    const candidates: UnknownFn[] = [
      mod["getServerUser"],
      mod["getCurrentUser"],
      mod["getServerAuthUser"],
      mod["requireUser"],
      mod["getUser"],
      mod["auth"],
    ].filter((fn): fn is UnknownFn => typeof fn === "function");

    for (const fn of candidates) {
      const res = await Promise.resolve(fn());

      if (isRecord(res) && "user" in res) {
        const u = (res as Record<string, unknown>)["user"];
        if (isRecord(u)) return u as ServerUser;
        return null;
      }

      if (isRecord(res)) return res as ServerUser;
    }

    return null;
  } catch {
    return null;
  }
}

function parseMonthParam(month?: string) {
  if (!month) return null;
  const parsed = new Date(`${month}-01T00:00:00`);
  return isValid(parsed) ? parsed : null;
}

function parseDayParam(day?: string) {
  if (!day) return null;
  const parsed = new Date(`${day}T00:00:00`);
  return isValid(parsed) ? parsed : null;
}

function toCalendarKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function getBusinessKeyFromAttendanceTimestamp(timestamp: Date) {
  // JST 18:00〜翌06:00（grace 120分）を「営業日」として扱う
  const dtf = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(timestamp);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const hh = get("hour");
  const mm = get("minute");

  const minutes = hh * 60 + mm;

  const startMin = 18 * 60;
  const endMin = 6 * 60;
  const grace = 120;
  const endWithGraceMin = endMin + grace;

  let keyDate: Date;

  if (minutes >= startMin) {
    keyDate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  } else if (minutes < endWithGraceMin) {
    keyDate = new Date(Date.UTC(y, m - 1, d - 1, 0, 0, 0));
  } else {
    keyDate = new Date(Date.UTC(y, m - 1, d - 1, 0, 0, 0));
  }

  const parts2 = dtf.formatToParts(keyDate);
  const get2 = (type: string) =>
    Number(parts2.find((p) => p.type === type)?.value ?? "0");
  const ky = get2("year");
  const km = get2("month");
  const kd = get2("day");
  return `${ky}-${String(km).padStart(2, "0")}-${String(kd).padStart(2, "0")}`;
}

async function updateApprovalAction(formData: FormData) {
  "use server";

  const user = await getServerUserCompat();
  if (!user) redirect("/login");

  const userId =
    typeof user?.id === "string"
      ? user.id
      : typeof user?.userId === "string"
        ? user.userId
        : undefined;
  if (!userId) redirect("/login");

  const store = await getOrCreateDefaultStore();
  const dateKey = String(formData.get("dateKey") ?? "");
  const approved = String(formData.get("approved") ?? "") === "true";

  const date = parseDayParam(dateKey);
  if (!date) return;

  await updateDayApproval({
    storeId: store.id,
    date,
    approved,
    approverId: userId,
  });

  revalidatePath("/dashboard/attendance");
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await getServerUserCompat();
  if (!user) redirect("/login");

  const store = await getOrCreateDefaultStore();

  const monthParam = parseMonthParam(searchParams.month);
  const monthStart = startOfMonth(monthParam ?? new Date());
  const monthEnd = endOfMonth(monthStart);

  const selectedDayParam = parseDayParam(searchParams.day);
  const selectedDayKey = selectedDayParam ? toCalendarKey(selectedDayParam) : null;

  const staffSelectValue = searchParams.staffId ?? "all";
  const staffFilter = staffSelectValue !== "all" ? staffSelectValue : null;

  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

  try {
    const staffList = await prisma.user.findMany({
      where: { storeId: store.id },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    });

    const attendances: AttendanceWithUser[] = await prisma.attendance.findMany({
      where: {
        storeId: store.id,
        timestamp: {
          gte: startOfDay(monthStart),
          lt: addDays(startOfDay(addDays(monthEnd, 1)), 0),
        },
        ...(staffFilter ? { userId: staffFilter } : {}),
      },
      include: {
        user: { select: { id: true, displayName: true } },
      },
      orderBy: { timestamp: "asc" },
    });

    const approvals: ApprovalState[] = await prisma.attendanceApproval
      .findMany({
        where: {
          storeId: store.id,
          date: {
            gte: startOfDay(monthStart),
            lt: addDays(startOfDay(addDays(monthEnd, 1)), 0),
          },
        },
        select: {
          date: true,
          isApproved: true,
          approvedAt: true,
          approvedById: true,
        },
        orderBy: { date: "asc" },
      })
      .then((rows) =>
        rows.map((r) => ({
          dateKey: toCalendarKey(r.date),
          isApproved: r.isApproved,
          approvedAt: r.approvedAt,
          approvedById: r.approvedById,
        }))
      );

    const approvalByDate = approvals.reduce<Record<string, ApprovalState>>(
      (acc, a) => {
        acc[a.dateKey] = a;
        return acc;
      },
      {}
    );

    const attendanceByBusinessDay = attendances.reduce<
      Record<string, AttendanceWithUser[]>
    >((acc, a) => {
      const key = getBusinessKeyFromAttendanceTimestamp(a.timestamp);
      acc[key] = acc[key] ?? [];
      acc[key].push(a);
      return acc;
    }, {});

    const selectedAttendances = selectedDayKey
      ? attendanceByBusinessDay[selectedDayKey] ?? []
      : [];

    const staffOptions = [{ id: "all", displayName: "全員" }, ...staffList];

    const prevMonth = format(subMonths(monthStart, 1), "yyyy-MM");
    const nextMonth = format(addDays(endOfMonth(monthStart), 1), "yyyy-MM");

    return (
      <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">勤怠管理</h1>
            <p className="text-sm text-slate-400">
              営業日（JST 18:00〜翌06:00）単位で表示します。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/attendance?month=${prevMonth}&staffId=${staffSelectValue}`}
            >
              <Button variant="secondary" size="sm">
                前月
              </Button>
            </Link>
            <Link
              href={`/dashboard/attendance?month=${nextMonth}&staffId=${staffSelectValue}`}
            >
              <Button variant="secondary" size="sm">
                次月
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="ghost" size="sm">
                ダッシュボードへ戻る
              </Button>
            </Link>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>フィルタ</CardTitle>
            <CardDescription>スタッフで絞り込みができます。</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-3 md:flex-row md:items-end"
              action="/dashboard/attendance"
              method="get"
            >
              <div className="grid gap-2">
                <Label htmlFor="month">月</Label>
                <Input
                  id="month"
                  name="month"
                  type="month"
                  defaultValue={format(monthStart, "yyyy-MM")}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="staffId">スタッフ</Label>
                <select
                  id="staffId"
                  name="staffId"
                  defaultValue={staffSelectValue}
                  className="h-10 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100"
                >
                  {staffOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <Button type="submit" className="md:mb-0">
                適用
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>日別詳細</CardTitle>
            <CardDescription>
              カレンダーで日付をクリックすると、該当営業日の打刻が表示されます。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedDayKey ? (
              <p className="text-sm text-slate-400">
                カレンダーから日付を選択してください。
              </p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm text-slate-400">選択中の営業日</p>
                    <p className="text-lg font-semibold">{selectedDayKey}</p>
                    <p className="text-xs text-slate-500">
                      ※この表示は営業日ラベル（JSTの暦日）です。打刻は 18:00〜翌06:00
                      を含みます。
                    </p>
                  </div>

                  <form action={updateApprovalAction} className="flex items-center gap-3">
                    <input type="hidden" name="dateKey" value={selectedDayKey} />
                    <input
                      type="hidden"
                      name="approved"
                      value={
                        approvalByDate[selectedDayKey]?.isApproved ? "false" : "true"
                      }
                    />
                    <Button
                      type="submit"
                      variant={approvalByDate[selectedDayKey]?.isApproved ? "secondary" : "default"}
                    >
                      {approvalByDate[selectedDayKey]?.isApproved ? "承認取消" : "承認"}
                    </Button>
                    {approvalByDate[selectedDayKey]?.isApproved ? (
                      <p className="text-xs text-slate-400">
                        承認済（
                        {approvalByDate[selectedDayKey]?.approvedAt
                          ? format(
                              approvalByDate[selectedDayKey]!.approvedAt!,
                              "M/d HH:mm"
                            )
                          : "-"}
                        ）
                      </p>
                    ) : null}
                  </form>
                </div>

                {selectedAttendances.length === 0 ? (
                  <p className="text-sm text-slate-400">この営業日の打刻はありません。</p>
                ) : (
                  <ul className="space-y-3">
                    {Object.entries(
                      selectedAttendances.reduce<Record<string, AttendanceWithUser[]>>(
                        (acc, a) => {
                          acc[a.user.id] = acc[a.user.id] ?? [];
                          acc[a.user.id].push(a);
                          return acc;
                        },
                        {}
                      )
                    ).map(([userId, list]) => {
                      const name = list[0]?.user.displayName ?? userId;
                      const sorted = [...list].sort(
                        (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
                      );

                      let clockIn: Date | null = null;
                      let totalMinutes = 0;
                      let breakMinutes = 0;
                      let breakStart: Date | null = null;

                      for (const r of sorted) {
                        if (r.type === "CLOCK_IN") clockIn = r.timestamp;
                        if (r.type === "BREAK_START") breakStart = r.timestamp;
                        if (r.type === "BREAK_END" && breakStart) {
                          breakMinutes += Math.max(
                            0,
                            differenceInMinutes(r.timestamp, breakStart)
                          );
                          breakStart = null;
                        }
                        if (r.type === "CLOCK_OUT" && clockIn) {
                          totalMinutes += Math.max(
                            0,
                            differenceInMinutes(r.timestamp, clockIn)
                          );
                          clockIn = null;
                        }
                      }
                      const netMinutes = Math.max(0, totalMinutes - breakMinutes);

                      return (
                        <li
                          key={userId}
                          className="rounded-lg border border-slate-800 bg-slate-950/40 p-4"
                        >
                          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                            <div>
                              <p className="text-base font-semibold">{name}</p>
                              <p className="text-xs text-slate-400">
                                勤務: {Math.floor(netMinutes / 60)}h {netMinutes % 60}m（休憩{" "}
                                {Math.floor(breakMinutes / 60)}h {breakMinutes % 60}m）
                              </p>
                            </div>
                            <div className="text-xs text-slate-500">
                              {approvalByDate[selectedDayKey]?.isApproved
                                ? "この日は承認済み"
                                : "未承認"}
                            </div>
                          </div>

                          <details className="mt-3">
                            <summary className="cursor-pointer text-sm text-slate-300">
                              打刻一覧
                            </summary>
                            <div className="mt-3 grid gap-2">
                              {sorted.map((attendance) => {
                                return (
                                  <div
                                    key={attendance.id}
                                    className="grid gap-2 rounded-md border border-slate-800 bg-slate-950/40 p-3 md:grid-cols-[180px,1fr]"
                                  >
                                    <div>
                                      <p className="text-xs text-slate-500">時刻</p>
                                      <p className="text-sm">
                                        {format(attendance.timestamp, "M/d HH:mm", {
                                          locale: ja,
                                        })}
                                      </p>
                                      <p className="mt-2 text-xs text-slate-500">種別</p>
                                      <p className="text-sm">{attendance.type}</p>
                                    </div>
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
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>月間カレンダー</CardTitle>
            <CardDescription>
              各日に出勤したスタッフを表示します。クリックで詳細を表示。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              {calendarDays.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const dayAttendances = attendanceByBusinessDay[key] ?? [];
                const uniqueNames = Array.from(
                  new Set(dayAttendances.map((a) => a.user.displayName))
                );
                const approved = approvalByDate[key];
                const isSelected = key === selectedDayKey;

                return (
                  <Link
                    key={key}
                    href={`/dashboard/attendance?month=${format(
                      monthStart,
                      "yyyy-MM"
                    )}&staffId=${staffSelectValue}&day=${key}`}
                    className="focus-visible:outline-none"
                  >
                    <div
                      className={`rounded-lg border bg-black/70 p-3 text-xs text-slate-200 transition-colors ${
                        isSelected ? "border-pink-500/60" : "border-slate-800"
                      }`}
                    >
                      <div className="flex items-baseline justify-between">
                        <p className="text-sm font-semibold text-pink-200">
                          {format(day, "M/d")}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {format(day, "EEE", { locale: ja })}
                        </p>
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
                          uniqueNames
                            .slice(0, 2)
                            .map((name) => <p key={name}>{name}</p>)
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
