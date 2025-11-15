// prisma/seed.ts
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/auth";

async function main() {
  // 環境変数から登録情報を読み込む
  const username = process.env.SEED_OWNER_USERNAME!;
  const password = process.env.SEED_OWNER_PASSWORD!;
  const displayName = process.env.SEED_OWNER_DISPLAY_NAME ?? "Owner";

  // パスワードをハッシュ化
  const passwordHash = await hashPassword(password);

  // ユーザーを作成
  await prisma.user.create({
    data: {
      username,
      displayName,
      role: "OWNER",
      passwordHash,
      isActive: true,
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
