import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { addDays, eachDayOfInterval, endOfMonth, format, startOfMonth } from "date-fns";
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
  };
};

export default async function AttendancePage({ searchParams }: AttendancePageProps) {
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  const defaultStore = await getOrCreateDefaultStore();
  const activeStoreId = session.user.storeId ?? defaultStore.id;

  const monthParam = searchParams?.month ?? format(new Date(), "yyyy-MM");
  const monthStart = startOfMonth(new Date(`${monthParam}-01`));
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

  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const attendanceByDate = attendances.reduce<Record<string, (typeof attendances)[number][]>>((acc, record) => {
    const key = format(record.timestamp, "yyyy-MM-dd");
    acc[key] = acc[key] ? [...acc[key], record] : [record];
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

      <div className="grid gap-6 lg:grid-cols-3">
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle>月間カレンダー</CardTitle>
          <CardDescription>各日に出勤したスタッフを表示します。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {calendarDays.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const dayAttendances = attendanceByDate[key] ?? [];
              const uniqueNames = Array.from(new Set(dayAttendances.map((a) => a.user.displayName)));
              const approved = dayAttendances.some((a) => Boolean(a.approvedAt));

              return (
                <div key={key} className="rounded-lg border border-slate-800 bg-black/70 p-3 text-xs text-slate-200">
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
                      uniqueNames.slice(0, 3).map((name) => <p key={name}>{name}</p>)
                    )}
                    {uniqueNames.length > 3 ? (
                      <p className="text-slate-500">+{uniqueNames.length - 3} 名</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>勤怠一覧</CardTitle>
          <CardDescription>承認・取消・編集・削除が可能です。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {attendances.length === 0 ? (
            <p className="text-sm text-slate-400">勤怠記録がありません。</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {attendances.map((attendance) => (
                <li key={attendance.id} className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-base font-semibold text-pink-200">{attendance.user.displayName}</p>
                      <p className="text-xs text-slate-400">
                        {format(attendance.timestamp, "yyyy-MM-dd HH:mm", { locale: ja })} / {
                          attendanceLabels[attendance.type] ?? attendance.type
                        }
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
}
