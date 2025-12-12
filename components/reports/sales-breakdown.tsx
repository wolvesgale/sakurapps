"use client";

import { useState, useTransition } from "react";
import { SalesDetails, type AdminSaleItem } from "@/components/attendance/sales-details";
import { Button } from "@/components/ui/button";

type SalesBreakdownProps = {
  dateKey: string;
  staffId?: string;
};

export function SalesBreakdown({ dateKey, staffId }: SalesBreakdownProps) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sales, setSales] = useState<AdminSaleItem[] | null>(null);
  const [pending, startTransition] = useTransition();

  const fetchSales = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date: dateKey });
      if (staffId) params.set("staffId", staffId);

      const res = await fetch(`/api/admin/sales?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "売上明細の取得に失敗しました");
      }

      const data = (await res.json()) as { sales?: AdminSaleItem[] };
      setSales(data.sales ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && sales === null) {
      startTransition(fetchSales);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        variant="ghost"
        size="sm"
        className="border border-slate-800 bg-slate-900/50"
        disabled={pending}
        onClick={handleToggle}
      >
        {expanded ? "内訳を閉じる" : "内訳を見る"}
      </Button>

      {expanded ? (
        <div className="rounded-md border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-200">
          {loading ? (
            <p className="text-slate-400">読み込み中...</p>
          ) : error ? (
            <p className="text-red-200">{error}</p>
          ) : sales ? (
            <SalesDetails dateKey={dateKey} sales={sales} />
          ) : (
            <p className="text-slate-400">売上明細がありません。</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

