"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";

export type TerminalCast = {
  id: string;
  displayName: string;
};

export type TerminalStore = {
  id: string;
  name: string;
  openingTime: string | null;
  closingTime: string | null;
  casts: TerminalCast[];
};

type AttendanceAction = "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END";

type SaleCategory = "SET" | "DRINK" | "BOTTLE" | "OTHER";

export function TerminalScreen({
  stores,
  defaultStoreId,
  defaultTerminalId
}: {
  stores: TerminalStore[];
  defaultStoreId?: string | null;
  defaultTerminalId?: string | null;
}) {
  const [selectedStoreId, setSelectedStoreId] = useState(
    defaultStoreId ?? stores[0]?.id ?? ""
  );
  const [selectedCastId, setSelectedCastId] = useState<string>("");
  const [pin, setPin] = useState("");
  const [pinValid, setPinValid] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [terminalMessage, setTerminalMessage] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingTerminal, setIsCheckingTerminal] = useState(false);
  const [terminalId, setTerminalId] = useState(defaultTerminalId ?? "");
  const [authorizedStoreId, setAuthorizedStoreId] = useState<string | null>(null);
  const [saleTable, setSaleTable] = useState("");
  const [saleCategory, setSaleCategory] = useState<SaleCategory>("SET");
  const [saleAmount, setSaleAmount] = useState("0");

  const store = useMemo(
    () => stores.find((s) => s.id === selectedStoreId) ?? null,
    [selectedStoreId, stores]
  );

  const casts = store?.casts ?? [];

  useEffect(() => {
    setSelectedCastId("");
    setPin("");
    setPinValid(false);
    setStatusMessage(null);
  }, [selectedStoreId]);

  useEffect(() => {
    setPin("");
    setPinValid(false);
    setStatusMessage(null);
  }, [selectedCastId]);

  useEffect(() => {
    let cancelled = false;
    if (pin.length === 4 && selectedCastId && authorizedStoreId && terminalId) {
      setIsVerifying(true);
      fetch("/api/terminal/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedCastId,
          pin,
          storeId: authorizedStoreId,
          terminalId
        })
      })
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled) {
            setPinValid(Boolean(data.valid));
            if (!data.valid) {
              setStatusMessage("PINが正しくありません");
            } else {
              setStatusMessage(null);
            }
          }
        })
        .catch(() => {
          if (!cancelled) {
            setStatusMessage("PIN確認中にエラーが発生しました");
            setPinValid(false);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsVerifying(false);
          }
        });
    } else {
      setPinValid(false);
    }

    return () => {
      cancelled = true;
    };
  }, [authorizedStoreId, pin, selectedCastId, terminalId]);

  const handleAuthorizeTerminal = async () => {
    if (!selectedStoreId || !terminalId) {
      setTerminalMessage("店舗と端末IDを入力してください");
      return;
    }
    setIsCheckingTerminal(true);
    setTerminalMessage(null);
    try {
      const res = await fetch("/api/terminal/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: selectedStoreId, terminalId })
      });
      const body = await res.json();
      if (!res.ok || !body.authorized) {
        throw new Error(body.error ?? "端末が許可されていません");
      }
      setAuthorizedStoreId(body.store.id);
      setSelectedStoreId(body.store.id);
      setTerminalMessage(`端末認証済み (${body.store.name})`);
    } catch (error) {
      setAuthorizedStoreId(null);
      setTerminalMessage((error as Error).message);
    } finally {
      setIsCheckingTerminal(false);
    }
  };

  const handleAttendance = async (type: AttendanceAction) => {
    if (!pinValid || !selectedCastId || !authorizedStoreId || !terminalId) {
      setStatusMessage("端末認証とキャスト選択、PIN確認を行ってください");
      return;
    }
    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/terminal/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedCastId,
          storeId: authorizedStoreId,
          terminalId,
          type
        })
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "エラーが発生しました");
      }
      setStatusMessage("勤怠を登録しました");
    } catch (err) {
      setStatusMessage((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSale = async () => {
    if (!pinValid || !selectedCastId || !authorizedStoreId || !terminalId) {
      setStatusMessage("端末認証とキャスト選択、PIN確認を行ってください");
      return;
    }
    const amount = Number(saleAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setStatusMessage("金額を正しく入力してください");
      return;
    }
    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/terminal/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedCastId,
          storeId: authorizedStoreId,
          terminalId,
          tableNumber: saleTable,
          category: saleCategory,
          amount
        })
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "エラーが発生しました");
      }
      setStatusMessage("売上を登録しました");
      setSaleTable("");
      setSaleAmount("0");
    } catch (err) {
      setStatusMessage((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formattedDate = format(new Date(), "yyyy年MM月dd日 (EEE)", { locale: ja });

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-slate-800 bg-black/80 p-6 shadow-lg">
        <div className="flex flex-col gap-2 text-center">
          <p className="text-sm text-slate-300">{formattedDate}</p>
          <h1 className="text-3xl font-semibold text-pink-300">
            {store?.name ?? "店舗を選択してください"}
          </h1>
          <p className="text-sm text-slate-400">
            営業時間: {store?.openingTime ?? "--:--"} - {store?.closingTime ?? "--:--"}
          </p>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4 rounded-2xl border border-slate-800 bg-black/70 p-6">
          <div className="space-y-2">
            <Label>店舗選択</Label>
            <Select
              value={selectedStoreId}
              onValueChange={setSelectedStoreId}
              disabled={Boolean(authorizedStoreId)}
            >
              <SelectTrigger>
                <SelectValue placeholder="店舗を選択" />
              </SelectTrigger>
              <SelectContent>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">端末登録された店舗のみ利用できます。</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="terminalId">端末ID</Label>
            <div className="flex gap-2">
              <Input
                id="terminalId"
                value={terminalId}
                onChange={(event) => setTerminalId(event.target.value.trim())}
                placeholder="端末ごとの登録ID"
                className="flex-1"
              />
              <Button
                type="button"
                onClick={handleAuthorizeTerminal}
                disabled={isCheckingTerminal}
                variant="secondary"
              >
                {isCheckingTerminal ? "確認中" : "認証"}
              </Button>
            </div>
            <p className="text-xs text-slate-400">
              起動時に店舗IDと端末IDを照合します。
            </p>
            {terminalMessage ? (
              <p className="text-xs text-pink-300">{terminalMessage}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>キャスト選択</Label>
            <Select
              value={selectedCastId}
              onValueChange={setSelectedCastId}
              disabled={!authorizedStoreId}
            >
              <SelectTrigger>
                <SelectValue placeholder="キャストを選択" />
              </SelectTrigger>
              <SelectContent>
                {casts.map((cast) => (
                  <SelectItem key={cast.id} value={cast.id}>
                    {cast.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>4桁PIN</Label>
            <Input
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              maxLength={4}
              placeholder="****"
              className="text-center text-2xl tracking-[0.4em] bg-slate-950"
            />
            <p className="text-xs text-slate-400">
              PINが正しい場合のみボタンが有効になります。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-lg font-semibold">
            <Button
              className="h-16 text-lg"
              disabled={!pinValid || isSubmitting || isVerifying || !authorizedStoreId}
              onClick={() => handleAttendance("CLOCK_IN")}
            >
              出勤
            </Button>
            <Button
              className="h-16 text-lg"
              variant="secondary"
              disabled={!pinValid || isSubmitting || isVerifying || !authorizedStoreId}
              onClick={() => handleAttendance("CLOCK_OUT")}
            >
              退勤
            </Button>
            <Button
              className="h-16 text-lg"
              variant="secondary"
              disabled={!pinValid || isSubmitting || isVerifying || !authorizedStoreId}
              onClick={() => handleAttendance("BREAK_START")}
            >
              休憩開始
            </Button>
            <Button
              className="h-16 text-lg"
              variant="secondary"
              disabled={!pinValid || isSubmitting || isVerifying || !authorizedStoreId}
              onClick={() => handleAttendance("BREAK_END")}
            >
              休憩終了
            </Button>
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-slate-800 bg-black/70 p-6">
          <h2 className="text-xl font-semibold text-pink-200">売上入力</h2>
          <div className="space-y-2">
            <Label htmlFor="table">卓番/伝票番号</Label>
            <Input
              id="table"
              value={saleTable}
              onChange={(event) => setSaleTable(event.target.value)}
              placeholder="例: A-12"
            />
          </div>
          <div className="space-y-2">
            <Label>区分</Label>
            <Select value={saleCategory} onValueChange={(value) => setSaleCategory(value as SaleCategory)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SET">セット</SelectItem>
                <SelectItem value="DRINK">ドリンク</SelectItem>
                <SelectItem value="BOTTLE">ボトル</SelectItem>
                <SelectItem value="OTHER">その他</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="amount">金額</Label>
            <Input
              id="amount"
              value={saleAmount}
              onChange={(event) => setSaleAmount(event.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
            />
          </div>
          <Button
            className="h-14 w-full text-lg"
            disabled={!pinValid || isSubmitting || isVerifying || !authorizedStoreId}
            onClick={handleSale}
          >
            売上を登録
          </Button>
        </div>
      </section>

      {statusMessage ? (
        <div className="rounded-2xl border border-pink-500/40 bg-pink-500/10 p-4 text-center text-base text-pink-100">
          {statusMessage}
        </div>
      ) : null}
    </div>
  );
}
