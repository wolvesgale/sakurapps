import Link from "next/link";
import { ArrowRight, LogIn, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentSession } from "@/lib/session";

export default async function HomePage() {
  const session = await getCurrentSession();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-16 text-slate-50">
      <div className="w-full max-w-3xl space-y-10">
        <div className="space-y-3 text-center">
          <p className="text-sm uppercase tracking-widest text-pink-400">Sakurapps v2</p>
          <h1 className="text-3xl font-semibold text-white sm:text-4xl">店舗端末と管理画面の入口</h1>
          <p className="text-slate-300">店舗運用の状況に合わせて、利用するモードを選択してください。</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader className="space-y-2">
              <div className="flex items-center gap-2 text-pink-300">
                <Smartphone className="h-5 w-5" />
                <CardTitle className="text-xl">店舗端末モード</CardTitle>
              </div>
              <CardDescription className="text-slate-400">
                端末ID + 店舗ID を照合し、キャスト名タップと PIN で打刻・売上入力を行います。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full justify-between bg-pink-500 text-white hover:bg-pink-400">
                <Link href="/terminal">
                  店舗端末画面へ
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader className="space-y-2">
              <div className="flex items-center gap-2 text-pink-300">
                <LogIn className="h-5 w-5" />
                <CardTitle className="text-xl">管理画面ログイン</CardTitle>
              </div>
              <CardDescription className="text-slate-400">
                OWNER / ADMIN / DRIVER はユーザーID + パスワードでログインし、ダッシュボードや管理ページを利用します。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                asChild
                variant="secondary"
                className="w-full justify-between border border-pink-500 text-pink-200 hover:bg-pink-900"
              >
                <Link href={session ? "/dashboard" : "/login"}>
                  {session ? "ダッシュボードへ" : "ログイン画面へ"}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              {session && (
                <p className="text-sm text-slate-400">現在ログイン中のユーザーとしてダッシュボードへ移動します。</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
