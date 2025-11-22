import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addDays, eachDayOfInterval, endOfMonth, formatISO, startOfDay, startOfMonth } from "date-fns";
import { ja } from "date-fns/locale";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { getOrCreateDefaultStore } from "@/lib/store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";

async function approveAttendanceDay(formData: FormData) {
  "use server";

  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    throw new Error("Unauthorized");
  }

  const dateValue = formData.get("date");
  const storeIdValue = formData.get("storeId");

  const resolvedStoreId =
    session.user.role === "ADMIN"
      ? session.user.storeId
      : typeof storeIdValue === "string" && storeIdValue.length > 0
        ? storeIdValue
        : null;

  if (!resolvedStoreId) {
    throw new Error("店舗を選択してください");
  }

  const parsedDate = typeof dateValue === "string" && dateValue.length > 0 ? new Date(dateValue) : new Date();
  const dayStart = startOfDay(parsedDate);

  await prisma.attendanceApproval.upsert({
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
  });

  revalidatePath("/dashboard/reports");
}

export const dynamic = "force-dynamic";

type ReportsPageProps = {
  searchParams?: {
    date?: string;
    storeId?: string;
    castId?: string;
  };
};

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  const defaultStore = await getOrCreateDefaultStore();
  const stores = await prisma.store.findMany({ orderBy: { name: "asc" } });

  const dateParam = searchParams?.date ?? formatISO(new Date(), { representation: "date" });
  const selectedDate = new Date(dateParam);
  const start = startOfDay(selectedDate);
  const end = addDays(start, 1);
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);

  const selectedStoreId =
    session.user.role === "ADMIN" ? session.user.storeId ?? undefined : searchParams?.storeId;

  const casts = await prisma.user.findMany({
    where: {
      role: "CAST",
      isActive: true,
      storeId: selectedStoreId ?? defaultStore.id
    },
    orderBy: { displayName: "asc" }
  });

  const selectedCastId = searchParams?.castId && casts.some((c) => c.id === searchParams.castId)
    ? searchParams.castId
    : undefined;

  const selectedStore = selectedStoreId ? stores.find((s) => s.id === selectedStoreId) : null;

  const [attendances, sales, monthlyAttendances, approvals] = await Promise.all([
    prisma.attendance.findMany({
      where: {
        timestamp: { gte: start, lt: end },
        storeId: selectedStoreId ?? defaultStore.id,
        ...(selectedCastId ? { userId: selectedCastId } : {})
      },
      include: { user: true, store: true },
      orderBy: { timestamp: "desc" }
    }),
    prisma.sale.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        ...(selectedStoreId ? { storeId: selectedStoreId } : {}),
        ...(selectedCastId ? { staffId: selectedCastId } : {}),
        storeId: selectedStoreId ?? defaultStore.id
      },
      include: { staff: true, store: true },
      orderBy: { createdAt: "desc" }
    }),
    prisma.attendance.findMany({
      where: {
        timestamp: { gte: monthStart, lt: addDays(monthEnd, 1) },
        storeId: selectedStoreId ?? defaultStore.id,
        ...(selectedCastId ? { userId: selectedCastId } : {})
      },
      include: { user: true, store: true },
      orderBy: { timestamp: "asc" }
    }),
    prisma.attendanceApproval.findMany({
      where: {
        date: { gte: monthStart, lt: addDays(monthEnd, 1) },
        ...(selectedStoreId ? { storeId: selectedStoreId } : {})
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

  const approvalKey =
    selectedStoreId && format(start, "yyyy-MM-dd")
      ? `${selectedStoreId}-${format(start, "yyyy-MM-dd")}`
      : null;
  const selectedApproval = approvalKey ? approvalByDate[approvalKey] : null;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-pink-300">レポート</h1>
      <Card>
        <CardHeader>
          <CardTitle>フィルター</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-3" method="get">
            <div className="space-y-2">
              <Label htmlFor="date">日付</Label>
              <Input id="date" name="date" type="date" defaultValue={formatISO(start, { representation: "date" })} />
            </div>
            <div className="space-y-2">
              <Label>店舗</Label>
              <Select name="storeId" defaultValue={selectedStoreId ?? ""}>
                <SelectTrigger>
                  <SelectValue placeholder="全店舗" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">全店舗</SelectItem>
                  {stores
                    .filter((store) =>
                      session.user.role === "ADMIN"
                        ? store.id === session.user.storeId
                        : true
                    )
                    .map((store) => (
                      <SelectItem key={store.id} value={store.id}>
                        {store.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>キャスト</Label>
              <Select name="castId" defaultValue={selectedCastId ?? ""}>
                <SelectTrigger>
                  <SelectValue placeholder="全キャスト" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">全キャスト</SelectItem>
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
          <CardDescription>選択された日付・店舗の勤怠を承認すると、キャスト端末からの打刻をロックします。</CardDescription>
        </CardHeader>
        <CardContent>
          {selectedStoreId ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-200">
                <p className="font-semibold text-pink-200">
                  {format(start, "yyyy-MM-dd")} / {selectedStore?.name ?? "店舗不明"}
                </p>
                <p className="text-xs text-slate-400">
                  {selectedApproval?.isApproved
                    ? `承認済み (${selectedApproval.approvedAt ? format(selectedApproval.approvedAt, "PPPp", { locale: ja }) : "時刻未記録"})`
                    : "未承認"}
                </p>
              </div>
              <form action={approveAttendanceDay} className="flex items-center gap-3">
                <input type="hidden" name="date" value={formatISO(start, { representation: "date" })} />
                <input type="hidden" name="storeId" value={selectedStoreId} />
                <Button type="submit" disabled={Boolean(selectedApproval?.isApproved)}>
                  {selectedApproval?.isApproved ? "承認済み" : "この日を承認"}
                </Button>
              </form>
            </div>
          ) : (
            <p className="text-sm text-slate-400">店舗を選択すると日次承認を実行できます。</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>勤怠一覧</CardTitle>
          </CardHeader>
          <CardContent>
            {attendances.length === 0 ? (
              <p className="text-sm text-slate-400">勤怠記録がありません。</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {attendances.map((attendance) => (
                  <li key={attendance.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                    <p className="font-semibold text-pink-200">{attendance.user.displayName}</p>
                    <p className="text-xs text-slate-400">{attendance.store?.name ?? "店舗不明"}</p>
                    <p className="text-xs text-slate-500">
                      {format(attendance.timestamp, "PPPp", { locale: ja })} / {attendance.type}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>売上一覧 (合計: {formatCurrency(salesTotal)})</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>給与計算 (カレンダー表示)</CardTitle>
          <CardDescription>
            店舗端末の勤怠はオーナーの日次締め後にキャストから変更できません。日ごとの出勤をカレンダーで確認してください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {calendarDays.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const dayAttendances = attendanceByDate[key] ?? [];
              const approvalKeyForDay = selectedStoreId ? `${selectedStoreId}-${key}` : null;
              const approvalForDay = approvalKeyForDay ? approvalByDate[approvalKeyForDay] : null;

              return (
                <div
                  key={key}
                  className="rounded-lg border border-slate-800 bg-black/70 p-3 text-xs text-slate-200"
                >
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
                          {attendance.user.displayName} / {attendance.store?.name ?? "店舗不明"}
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
    </div>
  );
}
