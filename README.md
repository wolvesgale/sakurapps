# Sakurapps 勤怠・売上管理システム v2

Next.js 14 (App Router) + Prisma + NextAuth で構築した、ガールズバー/飲食店向けの勤怠・売上管理システムです。オーナー・管理者・ドライバーはユーザーID + パスワードでログインし、キャストは店舗端末からユーザーID + PIN で打刻・売上入力のみを行います。

## 技術スタック

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS + shadcn/ui
- Prisma ORM + PostgreSQL
- NextAuth.js (Credentials Provider)

## セットアップ手順

1. 依存パッケージをインストールします。

   ```bash
   npm install
   ```

2. 環境変数を設定します。`.env.example` をコピーして `.env` を作成し、各値を調整してください。

   ```bash
   cp .env.example .env
   ```

   - `DATABASE_URL`: PostgreSQL の接続文字列
   - `NEXTAUTH_SECRET`: `openssl rand -base64 32` などで生成したランダム文字列
   - `NEXTAUTH_URL`: 開発/本番環境のホスト (例: `http://localhost:3000`)
   - `SEED_OWNER_USERNAME`: シード実行時に作成するオーナーのユーザーID
   - `SEED_OWNER_PASSWORD`: シード実行時に作成するオーナーのパスワード
   - `SEED_OWNER_DISPLAY_NAME`: シード実行時に作成するオーナーの表示名 (任意)

3. Prisma クライアントを生成し、マイグレーションを実行します。

   ```bash
   npx prisma generate
   npx prisma migrate dev --name init
   ```

   > PostgreSQL で `gen_random_uuid()` を利用するため、`pgcrypto` 拡張を有効にしておいてください。

4. 必要に応じてオーナーアカウントをシードします。

   ```bash
   npm run seed
   ```

   `.env` に設定した `SEED_OWNER_USERNAME` と `SEED_OWNER_PASSWORD` を利用して OWNER ユーザーが1件作成されます（すでに存在する場合は再作成されません）。

   OWNER / ADMIN / DRIVER アカウントのパスワードは 8文字以上・大文字・小文字・数字を含めてください。

5. 店舗端末を登録します（管理画面 > 端末管理）。

   - 端末ごとに発行したい ID（UUID など）を入力し、紐づけ店舗を選択して登録します。
   - 店舗端末 UI (`/terminal`) では起動時に端末ID + 店舗ID を送信し、許可リストと照合します。
   - 許可されていない端末からの打刻/売上登録は拒否されます。

6. 開発サーバーを起動します。

   ```bash
   npm run dev
   ```

## デプロイ (Vercel 想定)

Vercel にデプロイする場合は以下の環境変数を設定してください。

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL` (Vercel 上の URL)

Prisma のマイグレーションは CI/CD で実行するか、デプロイ後に `npx prisma migrate deploy` を実行してください。

## 実装済みページ / API 一覧

- `GET/POST /api/auth/[...nextauth]` – NextAuth.js の認証エンドポイント
- `POST /api/terminal/verify-pin` – キャスト PIN 検証
- `POST /api/terminal/attendance` – 勤怠レコード登録
- `POST /api/terminal/sales` – 売上レコード登録
- `POST /api/terminal/authorize` – 端末ID + 店舗ID の照合
- `/login` – オーナー/管理者/ドライバー向けログインフォーム
- `/dashboard` – ロール別ダッシュボード
- `/stores` – オーナー/管理者向け店舗管理
- `/staff` – オーナー/管理者向けキャスト・ドライバー管理
- `/reports` – 勤怠・売上レポート
- `/dashboard/terminal-mgmt` – 店舗端末許可リストの管理（管理画面側のルート。`(dashboard)` グループ内に配置し、キャスト用 `/terminal` と URL が重複しないように分離）
- `/terminal` – 店舗端末向けキャスト打刻/売上画面（端末IDを照合。ログイン不要）

## ルーティングとフォルダ構成

`/terminal`（キャスト端末向け）と `/dashboard/terminal-mgmt`（管理画面向け端末管理）の URL が衝突しないよう、フォルダ構成を以下に統一しています。

```
app/
├── (dashboard)/
│   ├── dashboard/
│   │   ├── page.tsx
│   │   └── terminal-mgmt/
│   │       └── page.tsx   # /dashboard/terminal-mgmt
│   ├── reports/
│   ├── staff/
│   └── stores/
├── terminal/               # /terminal（キャスト端末UI）
├── login/                  # /login（管理者系ログイン）
└── page.tsx                # ルート（ログインへリダイレクト）
```

`app/(dashboard)/terminal` 配下の旧ディレクトリは削除済みです。同名パスを生成するフォルダが残っていないかを `find app -path "*terminal*"` などで確認してください。

## 補足

- Prisma のスキーマは `prisma/schema.prisma` に、初回テーブル作成用の SQL は `docs/sql/schema.sql` に配置しています。
- Tailwind CSS と shadcn/ui コンポーネントを共用し、タブレット端末での操作を想定した UI を提供しています。

## 端末固定化と UI のポイント

- 店舗端末はログイン不要ですが、起動時に店舗IDと端末IDを送信し、登録済み端末かをサーバーで検証します。
- キャストは端末認証後に表示されるキャスト一覧から選択し、PIN を入力して打刻・売上登録を行います。
- 給与計算向けの勤怠カレンダーをレポート画面に追加し、日次締め後の編集を防ぐ運用を想定しています。
