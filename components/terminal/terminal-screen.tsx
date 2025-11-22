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

const fallbackStore: TerminalStore = {
  id: "dev-store",
  name: "開発店舗",
  openingTime: null,
  closingTime: null,
  casts: []
};

export function TerminalScreen() {
  const [stores, setStores] = useState<TerminalStore[]>([fallbackStore]);
  const [selectedStoreId, setSelectedStoreId] = useState(fallbackStore.id);
  const [selectedCastId, setSelectedCastId] = useState<string>("");
  const [pin, setPin] = useState("");
  const [pinValid, setPinValid] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [terminalMessage, setTerminalMessage] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingTerminal, setIsCheckingTerminal] = useState(false);
  const [terminalId, setTerminalId] = useState("dev-terminal");
  const [authorizedStoreId, setAuthorizedStoreId] = useState<string | null>(
    fallbackStore.id
  );
  const [saleTable, setSaleTable] = useState("");
  const [saleCategory, setSaleCategory] = useState<SaleCategory>("SET");
  const [saleAmount, setSaleAmount] = useState("0");

  useEffect(() => {
    let cancelled = false;

    const loadStores = async () => {
      try {
        const res = await fetch("/api/terminal/stores", { cache: "no-store" });
        const body = (await res.json()) as { stores?: TerminalStore[] };

        if (!cancelled) {
          const nextStores = body.stores?.length
            ? body.stores
            : [fallbackStore];
          const firstStoreId = nextStores[0]?.id ?? fallbackStore.id;
          setStores(nextStores);
          setSelectedStoreId(firstStoreId);
          setAuthorizedStoreId(firstStoreId);
        }
      } catch (error) {
        console.error("[terminal-screen] failed to load stores", error);
        if (!cancelled) {
          setStores([fallbackStore]);
          setSelectedStoreId(fallbackStore.id);
          setAuthorizedStoreId(fallbackStore.id);
          setTerminalMessage("店舗情報の取得に失敗しました (開発用ストアで継続)");
        }
      }
    };

    loadStores();

    return () => {
      cancelled = true;
    };
  }, []);

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
    setAuthorizedStoreId(selectedStoreId || fallbackStore.id);
  }, [selectedStoreId]);

  useEffect(() => {
    setPin("");
    setPinValid(false);
    setStatusMessage(null);
  }, [selectedCastId]);

  useEffect(() => {
    let cancelled = false;
    const targetStoreId = authorizedStoreId ?? selectedStoreId ?? fallbackStore.id;
    const targetTerminalId = terminalId || "dev-terminal";

    if (pin.length === 4 && selectedCastId && targetStoreId) {
      setIsVerifying(true);
      fetch("/api/terminal/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedCastId,
          pin,
          storeId: targetStoreId,
          terminalId: targetTerminalId
        })
      })
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled) {
            const valid = data.valid ?? true;
            setPinValid(Boolean(valid));
            setStatusMessage(valid ? null : "PINが正しくありません");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setStatusMessage("PIN確認をスキップしました");
            setPinValid(true);
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
  }, [authorizedStoreId, pin, selectedCastId, selectedStoreId, terminalId]);

  const handleAuthorizeTerminal = async () => {
    const targetStoreId = selectedStoreId || fallbackStore.id;
    const targetTerminalId = terminalId || "dev-terminal";
    setIsCheckingTerminal(true);
    setTerminalMessage(null);
    try {
      const res = await fetch("/api/terminal/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: targetStoreId, terminalId: targetTerminalId })
      });
      const body = await res.json().catch(() => null);
      const nextStoreId = body?.terminal?.storeId ?? targetStoreId;
      const nextTerminalId = body?.terminal?.deviceId ?? targetTerminalId;

      setAuthorizedStoreId(nextStoreId);
      setSelectedStoreId(nextStoreId);
      setTerminalId(nextTerminalId);
      setTerminalMessage("端末チェックをスキップして利用中 (開発モード)");
    } catch (error) {
      console.error("[terminal-screen] authorize skip", error);
      setAuthorizedStoreId(targetStoreId);
      setTerminalId(targetTerminalId);
      setTerminalMessage("端末チェックをスキップして利用中 (開発モード)");
    } finally {
      setIsCheckingTerminal(false);
    }
  };

  const handleAttendance = async (type: AttendanceAction) => {
    const targetStoreId = authorizedStoreId ?? selectedStoreId ?? fallbackStore.id;
    const targetTerminalId = terminalId || "dev-terminal";
    if (!pinValid || !selectedCastId) {
      setStatusMessage("キャスト選択とPIN確認を行ってください");
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
          storeId: targetStoreId,
          terminalId: targetTerminalId,
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
    const targetStoreId = authorizedStoreId ?? selectedStoreId ?? fallbackStore.id;
    const targetTerminalId = terminalId || "dev-terminal";
    if (!pinValid || !selectedCastId) {
      setStatusMessage("キャスト選択とPIN確認を行ってください");
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
          storeId: targetStoreId,
          terminalId: targetTerminalId,
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
            <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
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
            <p className="text-xs text-slate-500">開発モードでは全端末で利用できます。</p>
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
              現在は端末ID固定をスキップしています。
            </p>
            {terminalMessage ? (
              <p className="text-xs text-pink-300">{terminalMessage}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>キャスト選択</Label>
            <Select value={selectedCastId} onValueChange={setSelectedCastId}>
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
              disabled={!pinValid || isSubmitting || isVerifying || !selectedCastId}
              onClick={() => handleAttendance("CLOCK_IN")}
            >
              出勤
            </Button>
            <Button
              className="h-16 text-lg"
              variant="secondary"
              disabled={!pinValid || isSubmitting || isVerifying || !selectedCastId}
              onClick={() => handleAttendance("CLOCK_OUT")}
            >
              退勤
            </Button>
            <Button
              className="h-16 text-lg"
              variant="secondary"
              disabled={!pinValid || isSubmitting || isVerifying || !selectedCastId}
              onClick={() => handleAttendance("BREAK_START")}
            >
              休憩開始
            </Button>
            <Button
              className="h-16 text-lg"
              variant="secondary"
              disabled={!pinValid || isSubmitting || isVerifying || !selectedCastId}
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
            disabled={!pinValid || isSubmitting || isVerifying || !selectedCastId}
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
