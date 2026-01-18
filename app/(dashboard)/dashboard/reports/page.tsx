import { redirect } from "next/navigation";
import { addDays, eachDayOfInterval, endOfMonth, format, startOfMonth } from "date-fns";
import { ja } from "date-fns/locale";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { getOrCreateDefaultStore } from "@/lib/store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { SalesBreakdown } from "@/components/reports/sales-breakdown";

export const dynamic = "force-dynamic";

type ReportsPageProps = {
  searchParams?: {
    month?: string;
    staffId?: string;
  };
};

type SaleRecord = Prisma.SaleGetPayload<{ include: { staff: true } }>;

function summarizeDaily(sales: SaleRecord[]) {
  const map = new Map<
    string,
    { total: number; count: number; breakdown: Record<string, { total: number; name: string | null }> }
  >();

  sales.forEach((sale) => {
    const key = format(sale.createdAt, "yyyy-MM-dd");
    const existing = map.get(key) ?? { total: 0, count: 0, breakdown: {} };
    existing.total += sale.amount;
    existing.count += 1;
    const staffKey = sale.staffId;
    const current = existing.breakdown[staffKey] ?? { total: 0, name: sale.staff?.displayName ?? "キャスト不明" };
    existing.breakdown[staffKey] = {
      total: current.total + sale.amount,
      name: current.name
    };
    map.set(key, existing);
  });

  return map;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  const defaultStore = await getOrCreateDefaultStore();
  const activeStoreId = session.user.storeId ?? defaultStore.id;

  const monthParam = searchParams?.month;
  const parsedMonth =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? new Date(`${monthParam}-01`) : new Date();
  const monthStart = startOfMonth(parsedMonth);
  const monthEnd = endOfMonth(monthStart);

  try {
    const staffList = await prisma.user.findMany({
      where: { role: { in: ["CAST", "DRIVER"] }, isActive: true, storeId: activeStoreId },
      orderBy: { displayName: "asc" }
    });

    const staffParam = searchParams?.staffId;
    const selectedStaffId =
      staffParam && staffParam !== "__all__" && staffList.some((staff) => staff.id === staffParam)
        ? staffParam
        : undefined;

    const sales = await prisma.sale.findMany({
      where: {
        storeId: activeStoreId,
        createdAt: { gte: monthStart, lt: addDays(monthEnd, 1) },
        ...(selectedStaffId ? { staffId: selectedStaffId } : {})
      },
      include: { staff: true }
    });

    const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const dailyMap = summarizeDaily(sales);
    const totalAmount = sales.reduce((sum, sale) => sum + sale.amount, 0);
    const totalCount = sales.length;

    const staffSelectValue = selectedStaffId ?? "__all__";
    const staffLabel =
      staffSelectValue === "__all__"
        ? "売上合計（全員）"
        : `売上合計（${staffList.find((s) => s.id === staffSelectValue)?.displayName ?? "スタッフ"}）`;

    return (
      <div className="space-y-8">
        <h1 className="text-2xl font-semibold text-pink-300">レポート</h1>

        <Card>
          <CardHeader>
            <CardTitle>フィルター</CardTitle>
            <CardDescription>月別・スタッフ別に売上を集計します。</CardDescription>
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
              <CardTitle>{staffLabel}</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold text-pink-300">{formatCurrency(totalAmount)}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>売上件数</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold text-pink-300">{totalCount} 件</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>月間合計</CardTitle>
              <CardDescription>対象月の累計売上</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl font-bold text-pink-300">{formatCurrency(totalAmount)}</CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>日次サマリー</CardTitle>
            <CardDescription>日付ごとの売上と担当キャスト数を確認できます。</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="min-w-full text-left text-sm text-slate-200">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-2">日付</th>
                  <th className="px-2 py-2">スタッフ数</th>
                  <th className="px-2 py-2">売上合計</th>
                  <th className="px-2 py-2">詳細</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {calendarDays.map((day) => {
                  const key = format(day, "yyyy-MM-dd");
                  const daily = dailyMap.get(key);
                  const staffCount = daily ? Object.keys(daily.breakdown).length : 0;
                  return (
                    <tr key={key} className="hover:bg-slate-900/40">
                      <td className="px-2 py-3 text-pink-200">{format(day, "M/d (E)", { locale: ja })}</td>
                      <td className="px-2 py-3">{staffCount} 名</td>
                      <td className="px-2 py-3 font-semibold">{formatCurrency(daily?.total ?? 0)}</td>
                      <td className="px-2 py-3">
                        {daily ? (
                          <SalesBreakdown
                            dateKey={key}
                            staffId={staffSelectValue === "__all__" ? undefined : staffSelectValue}
                          />
                        ) : (
                          <span className="text-xs text-slate-500">売上なし</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    );
  } catch (error) {
    console.error("[reports] render", error);
    return (
      <div className="rounded-lg border border-red-900/40 bg-red-950/30 p-6 text-sm text-red-100">
        レポートデータの読み込みに失敗しました。時間をおいて再度お試しください。
      </div>
    );
  }
}

