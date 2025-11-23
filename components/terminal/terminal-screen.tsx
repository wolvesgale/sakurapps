"use client";

import { useEffect, useState } from "react";
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

type StoreInfo = {
  id: string | null;
  name: string;
  openingTime?: string | null;
  closingTime?: string | null;
};

type ActiveStaff = {
  id: string;
  displayName: string;
  clockInAt: string | null;
  isCompanion: boolean;
};

type AttendanceAction = "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END";

type PaymentMethod = "CASH" | "PAYPAY" | "CARD";

const FALLBACK_STORE_NAME = "Nest SAKURA";
const NO_SELECTION = "__none__";

export function TerminalScreen() {
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [casts, setCasts] = useState<TerminalCast[]>([]);
  const [selectedCastId, setSelectedCastId] = useState<string>(NO_SELECTION);
  const [saleCastId, setSaleCastId] = useState<string>(NO_SELECTION);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentTime, setCurrentTime] = useState<string>(
    format(new Date(), "yyyy年MM月dd日(E) HH:mm:ss", { locale: ja })
  );
  const [companionChecked, setCompanionChecked] = useState(false);
  const [salePayment, setSalePayment] = useState<PaymentMethod>("CASH");
  const [saleAmount, setSaleAmount] = useState("0");
  const [activeStaff, setActiveStaff] = useState<ActiveStaff[]>([]);
  const [isLoadingStore, setIsLoadingStore] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(format(new Date(), "yyyy年MM月dd日(E) HH:mm:ss", { locale: ja }));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchStore = async () => {
      setIsLoadingStore(true);
      try {
        const response = await fetch("/api/terminal/stores");
        if (!response.ok) {
          throw new Error("店舗情報を取得できませんでした");
        }
        const body = (await response.json()) as {
          stores?: { id: string; name: string; openingTime?: string | null; closingTime?: string | null; casts?: TerminalCast[] }[];
        };
        const firstStore = body.stores?.[0];
        if (firstStore) {
          setStore({
            id: firstStore.id,
            name: firstStore.name,
            openingTime: firstStore.openingTime,
            closingTime: firstStore.closingTime
          });
          setCasts(firstStore.casts ?? []);
          setSelectedCastId(NO_SELECTION);
          setSaleCastId(NO_SELECTION);
        } else {
          setStore({ id: "dev-store", name: FALLBACK_STORE_NAME, openingTime: null, closingTime: null });
          setCasts([]);
        }
      } catch (error) {
        console.error(error);
        setStore({ id: "dev-store", name: FALLBACK_STORE_NAME, openingTime: null, closingTime: null });
        setCasts([]);
      } finally {
        setIsLoadingStore(false);
      }
    };

    fetchStore();
  }, []);

  useEffect(() => {
    if (!store?.id) return;

    let interval: ReturnType<typeof setInterval> | null = null;

    const fetchActive = async () => {
      try {
        const response = await fetch(`/api/terminal/active-staff?storeId=${store.id}`);
        if (!response.ok) {
          throw new Error("出勤中メンバーの取得に失敗しました");
        }
        const body = (await response.json()) as { activeStaff?: ActiveStaff[] };
        setActiveStaff(body.activeStaff ?? []);
      } catch (error) {
        console.error(error);
      }
    };

    fetchActive();
    interval = setInterval(fetchActive, 30000);

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [store?.id]);

  const handleAttendance = async (type: AttendanceAction) => {
    if (!selectedCastId || selectedCastId === NO_SELECTION) {
      setStatusMessage("キャストを選択してください");
      return;
    }
    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/terminal/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: selectedCastId,
          storeId: store?.id,
          terminalId: null,
          type,
          isCompanion: companionChecked
        })
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "エラーが発生しました");
      }
      setStatusMessage("勤怠を登録しました");
      setCompanionChecked(false);
    } catch (err) {
      setStatusMessage((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSale = async () => {
    if (!saleCastId || saleCastId === NO_SELECTION) {
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
      const res = await fetch("/api/terminal/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: saleCastId,
          storeId: store?.id,
          paymentMethod: salePayment,
          amount,
          terminalId: null
        })
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "エラーが発生しました");
      }
      setStatusMessage("売上を登録しました");
      setSaleAmount("0");
      setSaleCastId(NO_SELECTION);
    } catch (err) {
      setStatusMessage((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderedStoreName = store?.name ?? FALLBACK_STORE_NAME;

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-slate-800 bg-black/80 p-6 shadow-lg">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-3xl font-semibold text-pink-300">{renderedStoreName}</h1>
          <p className="text-sm text-slate-300">{currentTime}</p>
          <p className="text-xs text-slate-500">
            端末IDチェックは開発モードのためスキップされています
          </p>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4 rounded-2xl border border-slate-800 bg-black/70 p-6">
          <div className="space-y-2">
            <Label>キャスト選択</Label>
            <Select
              value={selectedCastId}
              onValueChange={(value) => {
                setSelectedCastId(value);
              }}
              disabled={isLoadingStore}
            >
              <SelectTrigger>
                <SelectValue placeholder={isLoadingStore ? "読込中..." : "キャストを選択"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SELECTION} disabled>
                  キャストを選択
                </SelectItem>
                {casts.length === 0 ? (
                  <SelectItem value="__no_cast__" disabled>
                    キャストが登録されていません
                  </SelectItem>
                ) : (
                  casts.map((cast) => (
                    <SelectItem key={cast.id} value={cast.id}>
                      {cast.displayName}
                    </SelectItem>
                  ))
                )}
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
              disabled={isSubmitting || selectedCastId === NO_SELECTION || !store?.id}
              onClick={() => handleAttendance("CLOCK_IN")}
            >
              出勤
            </Button>
            <Button
              className="h-16 text-lg"
              variant="secondary"
              disabled={isSubmitting || selectedCastId === NO_SELECTION || !store?.id}
              onClick={() => handleAttendance("CLOCK_OUT")}
            >
              退勤
            </Button>
            <Button
              className="h-16 text-lg"
              variant="secondary"
              disabled={isSubmitting || selectedCastId === NO_SELECTION || !store?.id}
              onClick={() => handleAttendance("BREAK_START")}
            >
              休憩開始
            </Button>
            <Button
              className="h-16 text-lg"
              variant="secondary"
              disabled={isSubmitting || selectedCastId === NO_SELECTION || !store?.id}
              onClick={() => handleAttendance("BREAK_END")}
            >
              休憩終了
            </Button>
          </div>

          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-pink-200">現在出勤中</h3>
              <p className="text-xs text-slate-500">{store?.name ?? FALLBACK_STORE_NAME}</p>
            </div>
            <div className="space-y-2">
              {activeStaff.length === 0 ? (
                <p className="text-sm text-slate-500">出勤中のキャストはいません。</p>
              ) : (
                activeStaff.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between rounded-xl border border-slate-800 bg-black/60 px-3 py-2 text-sm text-slate-100"
                  >
                    <div className="flex flex-col">
                      <span className="font-semibold">{member.displayName}</span>
                      <span className="text-xs text-slate-400">
                        {member.clockInAt
                          ? `${format(new Date(member.clockInAt), "HH:mm")}〜`
                          : "時間未取得"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {member.isCompanion ? (
                        <span className="rounded-full bg-pink-900/60 px-2 py-1 text-[10px] text-pink-100">
                          同伴
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
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
              disabled={isLoadingStore}
            >
              <SelectTrigger>
                <SelectValue placeholder="選択してください" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CASH">現金</SelectItem>
                <SelectItem value="PAYPAY">PayPay</SelectItem>
                <SelectItem value="CARD">クレジットカード</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="saleCast">キャスト選択</Label>
            <Select value={saleCastId} onValueChange={setSaleCastId} disabled={isLoadingStore}>
              <SelectTrigger>
                <SelectValue placeholder={isLoadingStore ? "読込中..." : "キャストを選択"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SELECTION} disabled>
                  キャストを選択
                </SelectItem>
                {casts.length === 0 ? (
                  <SelectItem value="__no_cast__" disabled>
                    キャストが登録されていません
                  </SelectItem>
                ) : (
                  casts.map((cast) => (
                    <SelectItem key={cast.id} value={cast.id}>
                      {cast.displayName}
                    </SelectItem>
                  ))
                )}
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
            disabled={isSubmitting || saleCastId === NO_SELECTION || !store?.id}
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
