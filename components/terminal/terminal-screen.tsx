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

const STORE_NAME = "Nest SAKURA";

// TODO: API から取得するキャスト一覧に差し替える
const mockCasts: TerminalCast[] = [
  { id: "cast-001", displayName: "さくら" },
  { id: "cast-002", displayName: "れいな" },
  { id: "cast-003", displayName: "ゆい" },
  { id: "driver-001", displayName: "ドライバーA" }
];

// TODO: API から取得する出勤中キャスト一覧に差し替える
const mockActiveMembers = [
  { id: "cast-001", name: "さくら", role: "キャスト", since: "18:00" },
  { id: "driver-001", name: "ドライバーA", role: "ドライバー", since: "18:30" }
];

type AttendanceAction = "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END";

type PaymentMethod = "CASH" | "PAYPAY" | "CREDIT_CARD";

export function TerminalScreen() {
  const [selectedCastId, setSelectedCastId] = useState<string>("");
  const [saleCastId, setSaleCastId] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [terminalMessage] = useState<string | null>(
    "開発モードでは端末IDチェックをスキップしています"
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentTime, setCurrentTime] = useState<string>(
    format(new Date(), "yyyy年MM月dd日 HH:mm", { locale: ja })
  );
  const [companionChecked, setCompanionChecked] = useState(false);
  const [salePayment, setSalePayment] = useState<PaymentMethod>("CASH");
  const [saleAmount, setSaleAmount] = useState("0");

  const casts = useMemo(() => mockCasts, []);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      setCurrentTime(format(new Date(), "yyyy年MM月dd日 HH:mm", { locale: ja }));
      const now = new Date();
      const msUntilNextMinute = 60000 - now.getSeconds() * 1000 - now.getMilliseconds();
      timeout = setTimeout(tick, Math.max(1000, msUntilNextMinute));
    };

    timeout = setTimeout(tick, 60000);

    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, []);

  const handleAttendance = async (type: AttendanceAction) => {
    if (!selectedCastId) {
      setStatusMessage("キャストを選択してください");
      return;
    }
    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      // TODO: 同伴出勤フラグを API に渡すようにする
      const res = await fetch("/api/terminal/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedCastId,
          storeId: "dev-store",
          terminalId: "dev-terminal",
          type,
          isCompanion: companionChecked
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
    if (!saleCastId) {
      setStatusMessage("売上対象のキャストを選択してください");
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
      // TODO: 決済区分に合わせて API のカテゴリ定義を更新する
      const res = await fetch("/api/terminal/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: saleCastId,
          storeId: "dev-store",
          terminalId: "dev-terminal",
          tableNumber: "",
          category: "OTHER",
          amount
        })
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "エラーが発生しました");
      }
      setStatusMessage("売上を登録しました");
      setSaleAmount("0");
    } catch (err) {
      setStatusMessage((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-slate-800 bg-black/80 p-6 shadow-lg">
        <div className="flex flex-col gap-2 text-center">
          <p className="text-sm text-slate-300">{currentTime}</p>
          <h1 className="text-3xl font-semibold text-pink-300">{STORE_NAME}</h1>
          <p className="text-sm text-slate-400">
            営業時間: --:-- - --:--（後続タスクで店舗設定から取得予定）
          </p>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4 rounded-2xl border border-slate-800 bg-black/70 p-6">
          <div className="space-y-1">
            <Label className="text-sm text-slate-400">
              開発モードでは端末IDチェックをスキップしています
            </Label>
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

          <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
            <input
              id="companion"
              type="checkbox"
              checked={companionChecked}
              onChange={(event) => setCompanionChecked(event.target.checked)}
              className="h-4 w-4 rounded border border-slate-700 bg-black text-pink-400 focus-visible:outline-none"
            />
            <Label htmlFor="companion" className="text-sm text-slate-200">
              同伴出勤
            </Label>
          </div>

          <div className="grid grid-cols-2 gap-3 text-lg font-semibold">
            <Button
              className="h-16 text-lg"
              disabled={isSubmitting || !selectedCastId}
              onClick={() => handleAttendance("CLOCK_IN")}
            >
              出勤
            </Button>
            <Button
              className="h-16 text-lg"
              variant="secondary"
              disabled={isSubmitting || !selectedCastId}
              onClick={() => handleAttendance("CLOCK_OUT")}
            >
              退勤
            </Button>
            <Button
              className="h-16 text-lg"
              variant="secondary"
              disabled={isSubmitting || !selectedCastId}
              onClick={() => handleAttendance("BREAK_START")}
            >
              休憩開始
            </Button>
            <Button
              className="h-16 text-lg"
              variant="secondary"
              disabled={isSubmitting || !selectedCastId}
              onClick={() => handleAttendance("BREAK_END")}
            >
              休憩終了
            </Button>
          </div>

          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <h3 className="text-lg font-semibold text-pink-200">現在出勤中</h3>
            <div className="space-y-2">
              {mockActiveMembers.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded-xl border border-slate-800 bg-black/60 px-3 py-2 text-sm text-slate-100"
                >
                  <div className="flex flex-col">
                    <span className="font-semibold">{member.name}</span>
                    <span className="text-xs text-slate-400">{member.role}</span>
                  </div>
                  <span className="text-xs text-slate-300">{member.since}〜</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-slate-800 bg-black/70 p-6">
          <h2 className="text-xl font-semibold text-pink-200">売上入力</h2>

          <div className="space-y-2">
            <Label>区分</Label>
            <Select
              value={salePayment}
              onValueChange={(value) => setSalePayment(value as PaymentMethod)}
            >
              <SelectTrigger>
                <SelectValue placeholder="選択してください" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CASH">現金</SelectItem>
                <SelectItem value="PAYPAY">PayPay</SelectItem>
                <SelectItem value="CREDIT_CARD">クレジットカード</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="saleCast">キャスト選択</Label>
            <Select value={saleCastId} onValueChange={setSaleCastId}>
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
            disabled={isSubmitting || !saleCastId}
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
