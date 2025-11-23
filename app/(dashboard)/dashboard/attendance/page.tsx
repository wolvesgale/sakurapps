import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { addDays, eachDayOfInterval, endOfMonth, format, isValid, startOfDay, startOfMonth } from "date-fns";
import { ja } from "date-fns/locale";
import type { Prisma } from "@prisma/client";
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

type AttendanceRecord = Prisma.AttendanceGetPayload<{ include: { user: true; approvedBy: true } }>;

function calculateRoundedHours(records: AttendanceRecord[]) {
  // 勤務時間の集計は 15 分単位で切り上げる
  const grouped = new Map<string, AttendanceRecord[]>();

  records.forEach((record) => {
    const list = grouped.get(record.userId) ?? [];
    list.push(record);
    grouped.set(record.userId, list);
  });

  let totalMinutes = 0;

  grouped.forEach((userRecords) => {
    const sorted = [...userRecords].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    let currentStart: Date | null = null;

    sorted.forEach((record) => {
      if (record.type === "CLOCK_IN") {
        currentStart = record.timestamp;
      } else if (record.type === "CLOCK_OUT" && currentStart) {
        const minutes = (record.timestamp.getTime() - currentStart.getTime()) / (1000 * 60);
        if (minutes > 0) {
          // 15 分単位で切り上げ
          const rounded = Math.ceil(minutes / 15) * 15;
          totalMinutes += rounded;
        }
        currentStart = null;
      }
    });
  });

  return totalMinutes / 60;
}

async function approveAttendance(formData: FormData) {
  "use server";
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    throw new Error("Unauthorized");
  }

  const attendanceId = formData.get("attendanceId");

  if (!attendanceId || typeof attendanceId !== "string") {
    throw new Error("勤怠IDが不明です");
  }

  await prisma.attendance.update({
    where: { id: attendanceId },
    data: { approvedAt: new Date(), approvedById: session.user.id }
  });

  revalidatePath("/dashboard/attendance");
}

async function unapproveAttendance(formData: FormData) {
  "use server";
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    throw new Error("Unauthorized");
  }

  const attendanceId = formData.get("attendanceId");

  if (!attendanceId || typeof attendanceId !== "string") {
    throw new Error("勤怠IDが不明です");
  }

  await prisma.attendance.update({
    where: { id: attendanceId },
    data: { approvedAt: null, approvedById: null }
  });

  revalidatePath("/dashboard/attendance");
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

type AttendancePageProps = {
  searchParams?: {
    month?: string;
    staffId?: string;
    day?: string;
  };
};

export default async function AttendancePage({ searchParams }: AttendancePageProps) {
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  const defaultStore = await getOrCreateDefaultStore();
  const activeStoreId = session.user.storeId ?? defaultStore.id;

  try {
    const monthParam = searchParams?.month;
    const parsedMonth =
      monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? new Date(`${monthParam}-01`) : new Date();
    const monthStart = startOfMonth(parsedMonth);
    const monthEnd = endOfMonth(monthStart);
    const staffList = await prisma.user.findMany({
      where: { role: { in: ["CAST", "DRIVER"] }, isActive: true, storeId: activeStoreId },
      orderBy: { displayName: "asc" }
    });

    const staffFilterParam = searchParams?.staffId;
    const selectedStaffId =
      staffFilterParam && staffFilterParam !== "__all__" && staffList.some((staff) => staff.id === staffFilterParam)
        ? staffFilterParam
        : undefined;

    const attendances = await prisma.attendance.findMany({
      where: {
        storeId: activeStoreId,
        timestamp: { gte: monthStart, lt: addDays(monthEnd, 1) },
        ...(selectedStaffId ? { userId: selectedStaffId } : {})
      },
      include: { user: true, approvedBy: true },
      orderBy: { timestamp: "asc" }
    });

    const approvals = await prisma.attendanceApproval.findMany({
      where: {
        storeId: activeStoreId,
        date: { gte: startOfDay(monthStart), lt: addDays(monthEnd, 1) }
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
    const approvedCount = attendances.filter((a) => a.approvedAt).length;
    const salesTotal = await prisma.sale.aggregate({
      _sum: { amount: true },
      where: {
        storeId: activeStoreId,
        createdAt: { gte: monthStart, lt: addDays(monthEnd, 1) },
        ...(selectedStaffId ? { staffId: selectedStaffId } : {})
      }
    });

    const staffSelectValue = selectedStaffId ?? "__all__";
    const selectedDayParam = searchParams?.day;
    const selectedDay =
      selectedDayParam && isValid(new Date(selectedDayParam))
        ? startOfDay(new Date(selectedDayParam))
        : startOfDay(monthStart);
    const selectedDayKey = format(selectedDay, "yyyy-MM-dd");
    const selectedDayAttendances = attendanceByDate[selectedDayKey] ?? [];
    const selectedDayApproved = approvalByDate[selectedDayKey] ?? false;

    const workingHoursTotal = calculateRoundedHours(attendances);
    const workingHoursLabel =
      staffSelectValue === "__all__"
        ? "勤務時間合計（全員）"
        : `勤務時間合計（${staffList.find((s) => s.id === staffSelectValue)?.displayName ?? "スタッフ"}）`;

    return (
      <div className="space-y-8">
        <h1 className="text-2xl font-semibold text-pink-300">勤怠管理</h1>

        <Card>
          <CardHeader>
            <CardTitle>フィルター</CardTitle>
            <CardDescription>{defaultStore.name} の勤怠を月単位で確認します。</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-3" method="get">
              <div className="space-y-2">
                <Label htmlFor="month">月</Label>
                <Input id="month" name="month" type="month" defaultValue={format(monthStart, "yyyy-MM")} />
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
              <button type="submit" className="hidden" />
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle>記録件数</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold text-pink-300">{totalRecords} 件</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>承認済み</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold text-pink-300">{approvedCount} 件</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>売上合計</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold text-pink-300">
              {formatCurrency(salesTotal._sum.amount ?? 0)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{workingHoursLabel}</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold text-pink-300">{workingHoursTotal.toFixed(1)} 時間</CardContent>
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

                return (
                  <Link
                    key={key}
                    href={`/dashboard/attendance?month=${format(monthStart, "yyyy-MM")}&staffId=${staffSelectValue}&day=${key}`}
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
          <CardHeader>
            <CardTitle>{format(selectedDay, "yyyy-MM-dd (E)", { locale: ja })} の勤怠詳細</CardTitle>
            <CardDescription>
              {selectedDayApproved ? "この日は承認済みです" : "未承認です。必要に応じて承認してください。"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedDayAttendances.length === 0 ? (
              <p className="text-sm text-slate-400">勤怠記録がありません。</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {selectedDayAttendances.map((attendance) => (
                  <li key={attendance.id} className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-base font-semibold text-pink-200">{attendance.user.displayName}</p>
                        <p className="text-xs text-slate-400">
                          {format(attendance.timestamp, "HH:mm", { locale: ja })} / {" "}
                          {attendanceLabels[attendance.type] ?? attendance.type}
                        </p>
                        <p className="text-xs text-slate-400">同伴: {attendance.isCompanion ? "はい" : "いいえ"}</p>
                        <p className="text-xs text-slate-500">
                          {attendance.approvedAt
                            ? `承認済 (${format(attendance.approvedAt, "MM/dd HH:mm")})`
                            : "未承認"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <form action={approveAttendance}>
                          <input type="hidden" name="attendanceId" value={attendance.id} />
                          <Button type="submit" size="sm" disabled={Boolean(attendance.approvedAt)}>
                            承認
                          </Button>
                        </form>
                        <form action={unapproveAttendance}>
                          <input type="hidden" name="attendanceId" value={attendance.id} />
                          <Button type="submit" size="sm" variant="secondary">
                            取消
                          </Button>
                        </form>
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
                          defaultValue={format(attendance.timestamp, "yyyy-MM-dd'T'HH:mm")}
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
                  </li>
                ))}
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
