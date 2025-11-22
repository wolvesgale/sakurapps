import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/auth";

async function main() {
  const username = process.env.SEED_OWNER_USERNAME;
  const password = process.env.SEED_OWNER_PASSWORD;
  const displayName = process.env.SEED_OWNER_DISPLAY_NAME ?? "Owner";

  if (!username || !password) {
    throw new Error("SEED_OWNER_USERNAME と SEED_OWNER_PASSWORD を設定してください");
  }

  const passwordHash = await hashPassword(password);

  await prisma.user.upsert({
    where: { username },
    update: {},
    create: {
      username,
      displayName,
      role: "OWNER",
      passwordHash,
      isActive: true
    }
  });

  console.log(`Seed completed for owner user: ${username}`);
}

main()
  .catch((error) => {
    console.error("Seed failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
