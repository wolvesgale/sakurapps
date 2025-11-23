"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type AdminSaleItem = {
  id: string;
  staffName: string;
  staffId: string;
  paymentMethod: "CASH" | "PAYPAY" | "CARD";
  amount: number;
  createdAt: string;
};

type EditableSale = AdminSaleItem & {
  editingAmount?: string;
  editingPaymentMethod?: AdminSaleItem["paymentMethod"];
};

type SalesDetailsProps = {
  dateKey: string;
  sales: AdminSaleItem[];
};

const paymentLabels: Record<AdminSaleItem["paymentMethod"], string> = {
  CASH: "現金",
  PAYPAY: "PayPay",
  CARD: "クレジットカード"
};

const TZ = "Asia/Tokyo";

function formatJst(value: string, fmt: string) {
  const date = new Date(value);
  const jstString = date.toLocaleString("ja-JP", { timeZone: TZ });
  return format(new Date(jstString), fmt, { locale: ja });
}

export function SalesDetails({ dateKey, sales }: SalesDetailsProps) {
  const router = useRouter();
  const [items, setItems] = useState<EditableSale[]>(() => sales);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setItems(sales);
  }, [sales]);

  const handleAmountChange = (id: string, value: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, editingAmount: value } : item)));
  };

  const handlePaymentChange = (id: string, value: AdminSaleItem["paymentMethod"]) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, editingPaymentMethod: value } : item)));
  };

  const handleUpdate = async (id: string) => {
    const target = items.find((item) => item.id === id);
    if (!target) return;

    const amountValue = Number(target.editingAmount ?? target.amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setMessage("金額を正しく入力してください");
      return;
    }

    const method = target.editingPaymentMethod ?? target.paymentMethod;

    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/sales/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: amountValue, paymentMethod: method })
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "更新に失敗しました");
        }

        const updated = (await res.json()) as AdminSaleItem;
        setItems((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  amount: updated.amount,
                  paymentMethod: updated.paymentMethod,
                  editingAmount: undefined,
                  editingPaymentMethod: undefined
                }
              : item
          )
        );
        setMessage("更新しました");
        router.refresh();
      } catch (error) {
        setMessage((error as Error).message);
      }
    });
  };

  const handleDelete = async (id: string) => {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/sales/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "削除に失敗しました");
        }

        setItems((prev) => prev.filter((item) => item.id !== id));
        setMessage("削除しました");
        router.refresh();
      } catch (error) {
        setMessage((error as Error).message);
      }
    });
  };

  const totalAmount = useMemo(() => items.reduce((sum, item) => sum + item.amount, 0), [items]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm text-slate-200">
        <span>{dateKey} の売上明細</span>
        <span className="text-pink-200">合計: ¥{totalAmount.toLocaleString()}</span>
      </div>
      <div className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">売上明細がありません。</p>
        ) : (
          items.map((sale) => (
            <div
              key={sale.id}
              className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/70 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1 text-sm text-slate-100">
                <p className="font-semibold text-pink-200">{sale.staffName}</p>
                <p className="text-xs text-slate-400">
                  {formatJst(sale.createdAt, "HH:mm")} / {paymentLabels[sale.paymentMethod]}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-400">金額</Label>
                    <Input
                      className="h-9 w-32"
                      value={sale.editingAmount ?? sale.amount.toString()}
                      onChange={(e) => handleAmountChange(sale.id, e.target.value.replace(/[^0-9]/g, ""))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-400">決済</Label>
                    <Select
                      value={sale.editingPaymentMethod ?? sale.paymentMethod}
                      onValueChange={(value) => handlePaymentChange(sale.id, value as AdminSaleItem["paymentMethod"])}
                    >
                      <SelectTrigger className="h-9 w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CASH">現金</SelectItem>
                        <SelectItem value="PAYPAY">PayPay</SelectItem>
                        <SelectItem value="CARD">クレジットカード</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                <span className="text-base font-semibold text-pink-200">¥{sale.amount.toLocaleString()}</span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => handleUpdate(sale.id)}
                  >
                    更新
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    onClick={() => handleDelete(sale.id)}
                  >
                    削除
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      {message ? (
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-pink-100">{message}</div>
      ) : null}
    </div>
  );
}
