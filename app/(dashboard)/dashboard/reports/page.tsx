import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  formatISO,
  startOfDay,
  startOfMonth
} from "date-fns";
import { ja } from "date-fns/locale";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { getOrCreateDefaultStore } from "@/lib/store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

const attendanceLabels: Record<string, string> = {
  CLOCK_IN: "出勤",
  CLOCK_OUT: "退勤",
  BREAK_START: "休憩開始",
  BREAK_END: "休憩終了"
};

async function approveAttendanceDay(formData: FormData) {
  "use server";

  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    throw new Error("Unauthorized");
  }

  const dateValue = formData.get("date");
  const storeIdValue = formData.get("storeId");

  const defaultStore = await getOrCreateDefaultStore();

  const resolvedStoreId =
    session.user.role === "ADMIN"
      ? session.user.storeId ?? defaultStore.id
      : typeof storeIdValue === "string" && storeIdValue.length > 0
        ? storeIdValue
        : defaultStore.id;

  if (!resolvedStoreId) {
    throw new Error("店舗を選択してください");
  }

  const parsedDate = typeof dateValue === "string" && dateValue.length > 0 ? new Date(dateValue) : new Date();
  const dayStart = startOfDay(parsedDate);
  const dayEnd = addDays(dayStart, 1);

  await prisma.$transaction([
    prisma.attendanceApproval.upsert({
      where: {
        storeId_date: {
          storeId: resolvedStoreId,
          date: dayStart
        }
      },
      update: {
        isApproved: true,
        approvedAt: new Date(),
        approvedById: session.user.id
      },
      create: {
        store: { connect: { id: resolvedStoreId } },
        date: dayStart,
        isApproved: true,
        approvedAt: new Date(),
        approvedBy: { connect: { id: session.user.id } }
      }
    }),
    prisma.attendance.updateMany({
      where: {
        storeId: resolvedStoreId,
        timestamp: { gte: dayStart, lt: dayEnd }
      },
      data: { approvedAt: new Date(), approvedById: session.user.id }
    })
  ]);

  revalidatePath("/dashboard/reports");
}

async function unapproveAttendanceDay(formData: FormData) {
  "use server";

  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    throw new Error("Unauthorized");
  }

  const dateValue = formData.get("date");
  const storeIdValue = formData.get("storeId");

  const defaultStore = await getOrCreateDefaultStore();

  const resolvedStoreId =
    session.user.role === "ADMIN"
      ? session.user.storeId ?? defaultStore.id
      : typeof storeIdValue === "string" && storeIdValue.length > 0
        ? storeIdValue
        : defaultStore.id;

  if (!resolvedStoreId) {
    throw new Error("店舗を選択してください");
  }

  const parsedDate = typeof dateValue === "string" && dateValue.length > 0 ? new Date(dateValue) : new Date();
  const dayStart = startOfDay(parsedDate);
  const dayEnd = addDays(dayStart, 1);

  await prisma.$transaction([
    prisma.attendanceApproval.upsert({
      where: {
        storeId_date: {
          storeId: resolvedStoreId,
          date: dayStart
        }
      },
      update: {
        isApproved: false,
        approvedAt: null,
        approvedById: null
      },
      create: {
        store: { connect: { id: resolvedStoreId } },
        date: dayStart,
        isApproved: false
      }
    }),
    prisma.attendance.updateMany({
      where: {
        storeId: resolvedStoreId,
        timestamp: { gte: dayStart, lt: dayEnd }
      },
      data: { approvedAt: null, approvedById: null }
    })
  ]);

  revalidatePath("/dashboard/reports");
}

async function updateAttendanceRecord(formData: FormData) {
  "use server";

  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    throw new Error("Unauthorized");
  }

  const attendanceId = formData.get("attendanceId");
  const timestamp = formData.get("timestamp");

  if (!attendanceId || typeof attendanceId !== "string") {
    throw new Error("勤怠IDが不明です");
  }

  if (!timestamp || typeof timestamp !== "string") {
    throw new Error("日時を指定してください");
  }

  await prisma.attendance.update({
    where: { id: attendanceId },
    data: { timestamp: new Date(timestamp) }
  });

  revalidatePath("/dashboard/reports");
}

async function deleteAttendanceRecord(formData: FormData) {
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

  revalidatePath("/dashboard/reports");
}

type ReportsPageProps = {
  searchParams?: {
    date?: string;
    staffId?: string;
  };
};

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  const defaultStore = await getOrCreateDefaultStore();
  const activeStoreId = session.user.storeId ?? defaultStore.id;

  const dateParam = searchParams?.date ?? formatISO(new Date(), { representation: "date" });
  const selectedDate = startOfDay(new Date(dateParam));
  const dayEnd = addDays(selectedDate, 1);
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);

  const casts = await prisma.user.findMany({
    where: {
      role: "CAST",
      isActive: true,
      storeId: activeStoreId
    },
    orderBy: { displayName: "asc" }
  });

  const selectedCastId =
    searchParams?.staffId && casts.some((c) => c.id === searchParams.staffId)
      ? searchParams.staffId
      : undefined;

  const [attendances, sales, monthlyAttendances, approvals] = await Promise.all([
    prisma.attendance.findMany({
      where: {
        timestamp: { gte: selectedDate, lt: dayEnd },
        storeId: activeStoreId,
        ...(selectedCastId ? { userId: selectedCastId } : {})
      },
      include: { user: true, store: true, approvedBy: true },
      orderBy: { timestamp: "asc" }
    }),
    prisma.sale.findMany({
      where: {
        createdAt: { gte: selectedDate, lt: dayEnd },
        storeId: activeStoreId,
        ...(selectedCastId ? { staffId: selectedCastId } : {})
      },
      include: { staff: true, store: true },
      orderBy: { createdAt: "desc" }
    }),
    prisma.attendance.findMany({
      where: {
        timestamp: { gte: monthStart, lt: addDays(monthEnd, 1) },
        storeId: activeStoreId
      },
      include: { user: true },
      orderBy: { timestamp: "asc" }
    }),
    prisma.attendanceApproval.findMany({
      where: {
        date: { gte: monthStart, lt: addDays(monthEnd, 1) },
        storeId: activeStoreId
      },
      include: { approvedBy: true, store: true }
    })
  ]);

  const salesTotal = sales.reduce((sum, sale) => sum + sale.amount, 0);
  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const attendanceByDate = monthlyAttendances.reduce<Record<string, typeof monthlyAttendances[number][]>>(
    (acc, record) => {
      const key = format(record.timestamp, "yyyy-MM-dd");
      acc[key] = acc[key] ? [...acc[key], record] : [record];
      return acc;
    },
    {}
  );

  const approvalByDate = approvals.reduce<Record<string, (typeof approvals)[number]>>((acc, approval) => {
    const key = `${approval.storeId}-${format(approval.date, "yyyy-MM-dd")}`;
    acc[key] = approval;
    return acc;
  }, {});

  const approvalKey = `${activeStoreId}-${format(selectedDate, "yyyy-MM-dd")}`;
  const selectedApproval = approvalByDate[approvalKey];

  const selectedCastMonthlyRecords = selectedCastId
    ? monthlyAttendances.filter((record) => record.userId === selectedCastId)
    : [];

  const staffSelectValue = selectedCastId ?? "__all__";

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-pink-300">レポート / 勤怠承認</h1>
      <Card>
        <CardHeader>
          <CardTitle>フィルター</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-3" method="get">
            <div className="space-y-2">
              <Label htmlFor="date">日付</Label>
              <Input id="date" name="date" type="date" defaultValue={formatISO(selectedDate, { representation: "date" })} />
            </div>
            <div className="space-y-2">
              <Label>キャスト</Label>
              <Select name="staffId" defaultValue={staffSelectValue}>
                <SelectTrigger>
                  <SelectValue placeholder="全キャスト" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全キャスト</SelectItem>
                  {casts.map((cast) => (
                    <SelectItem key={cast.id} value={cast.id}>
                      {cast.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <button type="submit" className="hidden" />
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>日次承認</CardTitle>
          <CardDescription>選択された日付の勤怠を承認・修正します。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-200">
              <p className="font-semibold text-pink-200">
                {format(selectedDate, "yyyy-MM-dd (E)", { locale: ja })} / {defaultStore.name}
              </p>
              <p className="text-xs text-slate-400">
                {selectedApproval?.isApproved
                  ? `承認済み (${selectedApproval.approvedAt ? format(selectedApproval.approvedAt, "PPPp", { locale: ja }) : "時刻未記録"})`
                  : "未承認"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <form action={approveAttendanceDay}>
                <input type="hidden" name="date" value={formatISO(selectedDate, { representation: "date" })} />
                <input type="hidden" name="storeId" value={activeStoreId} />
                <Button type="submit" disabled={Boolean(selectedApproval?.isApproved)}>
                  {selectedApproval?.isApproved ? "承認済み" : "この日を承認"}
                </Button>
              </form>
              {selectedApproval?.isApproved ? (
                <form action={unapproveAttendanceDay}>
                  <input type="hidden" name="date" value={formatISO(selectedDate, { representation: "date" })} />
                  <input type="hidden" name="storeId" value={activeStoreId} />
                  <Button type="submit" variant="secondary">
                    承認を取り消す
                  </Button>
                </form>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-pink-200">勤怠記録</h3>
              {attendances.length === 0 ? (
                <p className="text-sm text-slate-400">勤怠記録がありません。</p>
              ) : (
                <ul className="space-y-3 text-sm">
                  {attendances.map((attendance) => (
                    <li key={attendance.id} className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-pink-200">{attendance.user.displayName}</p>
                          <p className="text-xs text-slate-400">{attendanceLabels[attendance.type] ?? attendance.type}</p>
                          <p className="text-xs text-slate-500">
                            {format(attendance.timestamp, "PPPp", { locale: ja })}
                            {attendance.isCompanion ? " / 同伴" : ""}
                          </p>
                          {attendance.approvedAt ? (
                            <p className="text-[11px] text-green-300">
                              承認済: {format(attendance.approvedAt, "PPPp", { locale: ja })}
                            </p>
                          ) : null}
                        </div>
                        <form action={deleteAttendanceRecord} className="flex flex-col items-end gap-2">
                          <input type="hidden" name="attendanceId" value={attendance.id} />
                          <Button type="submit" variant="destructive" size="sm">
                            削除
                          </Button>
                        </form>
                      </div>
                      <form action={updateAttendanceRecord} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input type="hidden" name="attendanceId" value={attendance.id} />
                        <Label className="text-xs text-slate-400">時刻を修正</Label>
                        <Input
                          type="datetime-local"
                          name="timestamp"
                          defaultValue={format(attendance.timestamp, "yyyy-MM-dd'T'HH:mm")}
                          className="sm:max-w-xs"
                        />
                        <Button type="submit" size="sm" variant="secondary">
                          更新
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-pink-200">売上一覧 (合計: {formatCurrency(salesTotal)})</h3>
              {sales.length === 0 ? (
                <p className="text-sm text-slate-400">売上記録がありません。</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {sales.map((sale) => (
                    <li key={sale.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                      <p className="font-semibold text-pink-200">{sale.staff?.displayName ?? "キャスト不明"}</p>
                      <p className="text-xs text-slate-400">{sale.store?.name ?? "店舗不明"}</p>
                      <p className="text-xs text-slate-500">
                        {format(sale.createdAt, "PPPp", { locale: ja })} / 支払方法: {sale.paymentMethod}
                      </p>
                      <p className="text-sm text-slate-200">金額: {formatCurrency(sale.amount)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>給与計算 (カレンダー表示)</CardTitle>
          <CardDescription>出勤の有無と承認状況を日ごとに確認できます。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {calendarDays.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const dayAttendances = attendanceByDate[key] ?? [];
              const approvalKeyForDay = `${activeStoreId}-${key}`;
              const approvalForDay = approvalByDate[approvalKeyForDay];

              return (
                <div key={key} className="rounded-lg border border-slate-800 bg-black/70 p-3 text-xs text-slate-200">
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm font-semibold text-pink-200">{format(day, "M/d")}</p>
                    <p className="text-[11px] text-slate-500">{format(day, "EEE", { locale: ja })}</p>
                  </div>
                  {approvalForDay?.isApproved ? (
                    <p className="mt-1 rounded-full bg-pink-900/50 px-2 py-1 text-[11px] text-pink-200">承認済</p>
                  ) : null}
                  <div className="mt-2 space-y-1">
                    {dayAttendances.length === 0 ? (
                      <p className="text-slate-600">出勤なし</p>
                    ) : (
                      dayAttendances.slice(0, 3).map((attendance) => (
                        <p key={attendance.id} className="leading-snug">
                          {attendance.user.displayName}
                        </p>
                      ))
                    )}
                    {dayAttendances.length > 3 ? (
                      <p className="text-slate-500">+{dayAttendances.length - 3} 件</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {selectedCastId ? (
        <Card>
          <CardHeader>
            <CardTitle>キャスト別履歴</CardTitle>
            <CardDescription>
              {casts.find((cast) => cast.id === selectedCastId)?.displayName ?? "キャスト"} の月次勤怠です。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedCastMonthlyRecords.length === 0 ? (
              <p className="text-sm text-slate-400">該当する勤怠がありません。</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {selectedCastMonthlyRecords.map((attendance) => (
                  <li key={attendance.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-pink-200">{attendanceLabels[attendance.type] ?? attendance.type}</p>
                      <p className="text-xs text-slate-500">{format(attendance.timestamp, "PPPp", { locale: ja })}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
