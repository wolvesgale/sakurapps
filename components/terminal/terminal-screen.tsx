// components/terminal/terminal-screen.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import Link from "next/link";
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
  role: "CAST" | "DRIVER";
};

type StoreInfo = {
  id: string | null;
  name: string;
  openingTime?: string | null;
  closingTime?: string | null;
};

// ✅ API: GET /api/terminal/attendance の返却に合わせる
type ActiveStaff = {
  userId: string;
  displayName: string;
  state: "WORKING" | "BREAK";
  lastType: "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END";
  lastTimestamp: string; // ISO想定
};

type AttendanceAction = "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END";

type PaymentMethod = "CASH" | "PAYPAY" | "CARD";

const FALLBACK_STORE_NAME = "Nest SAKURA";
const NO_SELECTION = "__none__";

// ✅ 復活（常時表示）
const SHOW_ACTIVE_STAFF = true;

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

  // ※ 現状は開発モードで terminalId=null のまま（既存仕様維持）
  const terminalId: string | null = null;

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
          stores?: {
            id: string;
            name: string;
            openingTime?: string | null;
            closingTime?: string | null;
            casts?: TerminalCast[];
          }[];
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

  // ✅ 出勤中スタッフ取得：GET /api/terminal/attendance を使用
  const fetchActiveStaff = async (storeId: string) => {
    try {
      const qs = new URLSearchParams();
      qs.set("storeId", storeId);
      if (terminalId) qs.set("terminalId", terminalId);

      const response = await fetch(`/api/terminal/attendance?${qs.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        // 端末認証NGなどは表示を壊さない（既存影響回避）
        return;
      }
      const body = (await response.json()) as { activeStaff?: ActiveStaff[] };
      setActiveStaff(body.activeStaff ?? []);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (!SHOW_ACTIVE_STAFF || !store?.id) return;

    let interval: ReturnType<typeof setInterval> | null = null;

    fetchActiveStaff(store.id);

    // 既存の15秒更新はそのまま（必要なら30秒にもできる）
    interval = setInterval(() => {
      if (store.id) {
        fetchActiveStaff(store.id);
      }
    }, 15000);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [store?.id]);

  useEffect(() => {
    if (!cameraOpen) {
      stopStream();
      return;
    }

    const startStream = async () => {
      try {
        setCameraError(null);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (error) {
        console.error("[camera]", error);
        setCameraError("カメラの起動に失敗しました。権限を確認してください。");
      }
    };

    startStream();

    return () => {
      stopStream();
    };
  }, [cameraOpen]);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const handleAttendance = async (type: AttendanceAction, photoUrl?: string) => {
    if (!selectedCastId || selectedCastId === NO_SELECTION) {
      setStatusMessage("キャストを選択してください");
      return;
    }
    if (!store?.id) {
      setStatusMessage("店舗情報が取得できていません");
      return;
    }
    if (type === "CLOCK_IN" && !photoUrl) {
      setStatusMessage("出勤時の写真を撮影してください");
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
          storeId: store.id,
          terminalId: terminalId,
          type,
          isCompanion: companionChecked,
          photoUrl
        })
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // ✅ 順序チェックのエラーもここに来る（「勤怠状態を確認してください」）
        throw new Error((body as { error?: string }).error ?? "エラーが発生しました");
      }

      setStatusMessage("勤怠を登録しました");
      setCompanionChecked(false);

      if (store.id) {
        fetchActiveStaff(store.id);
      }
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
          terminalId: terminalId
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

  const castLabel = (cast: TerminalCast) => (
    <div className="flex items-center gap-2">
      <span>{cast.displayName}</span>
      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] uppercase text-slate-200">
        {cast.role}
      </span>
    </div>
  );

  // keep a stable reference for Select options so Radix doesn't re-render unexpectedly
  const selectableCasts = React.useMemo(() => casts, [casts]);

  const openCameraForClockIn = () => {
    if (!selectedCastId || selectedCastId === NO_SELECTION) {
      setStatusMessage("キャストを選択してください");
      return;
    }
    setCapturedDataUrl(null);
    setCameraError(null);
    setCameraOpen(true);
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const width = video.videoWidth;
    const height = video.videoHeight;
    const targetWidth = Math.min(1280, Math.max(640, width));
    const targetHeight = Math.round((height / width) * targetWidth);
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    setCapturedDataUrl(dataUrl);
    stopStream();
  };

  const closeCamera = () => {
    stopStream();
    setCapturedDataUrl(null);
    setCameraOpen(false);
  };

  const submitClockInWithPhoto = async () => {
    if (!capturedDataUrl) {
      setStatusMessage("写真を撮影してください");
      return;
    }
    setIsSubmitting(true);
    try {
      const uploadRes = await fetch("/api/terminal/attendance-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData: capturedDataUrl })
      });
      if (!uploadRes.ok) {
        const body = await uploadRes.json();
        throw new Error(body.error ?? "写真のアップロードに失敗しました");
      }
      const { url } = (await uploadRes.json()) as { url: string };
      await handleAttendance("CLOCK_IN", url);
      setCameraOpen(false);
      setCapturedDataUrl(null);
    } catch (error) {
      setStatusMessage((error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatHm = (iso: string) => {
    try {
      return format(new Date(iso), "HH:mm");
    } catch {
      return "—";
    }
  };

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-slate-800 bg-black/80 p-6 shadow-lg">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-3xl font-semibold text-pink-300">{renderedStoreName}</h1>
          <p className="text-sm text-slate-300">{currentTime}</p>
          <p className="text-xs text-slate-500">端末IDチェックは開発モードのためスキップされています</p>
        </div>
        <div className="mt-4 flex justify-center">
          <Link href="/">
            <Button variant="secondary" size="sm">
              TOPに戻る
            </Button>
          </Link>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4 rounded-2xl border border-slate-800 bg-black/70 p-6">
          <div className="space-y-2">
            <Label>スタッフ選択</Label>
            <Select
              value={selectedCastId}
              onValueChange={(value) => {
                setSelectedCastId(value);
              }}
              disabled={isLoadingStore}
            >
              <SelectTrigger>
                <SelectValue placeholder={isLoadingStore ? "読込中..." : "スタッフを選択"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SELECTION} disabled>
                  スタッフを選択
                </SelectItem>
                {selectableCasts.length === 0 ? (
                  <SelectItem value="__no_cast__" disabled>
                    スタッフが登録されていません
                  </SelectItem>
                ) : (
                  selectableCasts.map((cast) => (
                    <SelectItem key={cast.id} value={cast.id}>
                      {castLabel(cast)}
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
              onClick={openCameraForClockIn}
            >
              出勤（写真必須）
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

          {/* ✅ 出勤中スタッフ表示（復活） */}
          {SHOW_ACTIVE_STAFF ? (
            <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-pink-200">出勤中スタッフ</h3>
                <p className="text-xs text-slate-500">{store?.name ?? FALLBACK_STORE_NAME}</p>
              </div>

              <div className="space-y-2">
                {activeStaff.length === 0 ? (
                  <p className="text-sm text-slate-500">出勤中のスタッフはいません。</p>
                ) : (
                  activeStaff.map((member) => (
                    <div
                      key={member.userId}
                      className="flex items-center justify-between rounded-xl border border-slate-800 bg-black/60 px-3 py-2 text-sm text-slate-100"
                    >
                      <div className="flex flex-col">
                        <span className="font-semibold">{member.displayName}</span>
                        <span className="text-xs text-slate-400">
                          {member.state === "BREAK" ? "休憩中" : "勤務中"} / 最終: {formatHm(member.lastTimestamp)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {member.state === "BREAK" ? (
                          <span className="rounded-full bg-slate-800/80 px-2 py-1 text-[10px] text-slate-100">
                            BREAK
                          </span>
                        ) : (
                          <span className="rounded-full bg-pink-900/40 px-2 py-1 text-[10px] text-pink-100">
                            WORK
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!store?.id}
                  onClick={() => {
                    if (store?.id) fetchActiveStaff(store.id);
                  }}
                >
                  更新
                </Button>
              </div>
            </div>
          ) : null}
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
            <Label htmlFor="saleCast">売上担当スタッフ</Label>
            <Select value={saleCastId} onValueChange={setSaleCastId} disabled={isLoadingStore}>
              <SelectTrigger>
                <SelectValue placeholder={isLoadingStore ? "読込中..." : "スタッフを選択"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SELECTION} disabled>
                  スタッフを選択
                </SelectItem>
                {selectableCasts.length === 0 ? (
                  <SelectItem value="__no_cast__" disabled>
                    スタッフが登録されていません
                  </SelectItem>
                ) : (
                  selectableCasts.map((cast) => (
                    <SelectItem key={cast.id} value={cast.id}>
                      {castLabel(cast)}
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

      {cameraOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-pink-200">出勤用の写真を撮影</h3>
              <Button variant="ghost" size="sm" onClick={closeCamera}>
                閉じる
              </Button>
            </div>
            <div className="aspect-video w-full overflow-hidden rounded-xl border border-slate-800 bg-black">
              {capturedDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={capturedDataUrl} alt="撮影プレビュー" className="h-full w-full object-cover" />
              ) : (
                <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>
            {cameraError ? <p className="text-sm text-red-400">{cameraError}</p> : null}
            <div className="flex flex-wrap gap-2">
              {capturedDataUrl ? (
                <>
                  <Button onClick={submitClockInWithPhoto} disabled={isSubmitting}>
                    この写真で出勤
                  </Button>
                  <Button variant="secondary" onClick={() => setCapturedDataUrl(null)} disabled={isSubmitting}>
                    撮り直す
                  </Button>
                </>
              ) : (
                <Button onClick={capturePhoto} disabled={isSubmitting || Boolean(cameraError)}>
                  ライブカメラで撮影
                </Button>
              )}
              <Button variant="ghost" onClick={closeCamera} disabled={isSubmitting}>
                キャンセル
              </Button>
            </div>
            <p className="text-xs text-slate-400">
              iPhone Safari ではインカメラが起動します。権限を許可できない場合は写真が取得できず出勤登録できません。
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
