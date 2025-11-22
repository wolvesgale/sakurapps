const { PrismaClient } = require("@prisma/client");
const { hash } = require("bcryptjs");

function isStrongPassword(password) {
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  return password.length >= 8 && hasUpper && hasLower && hasNumber;
}

async function main() {
  const prisma = new PrismaClient();

  const email = process.env.SEED_OWNER_EMAIL?.toLowerCase();
  const usernameEnv = process.env.SEED_OWNER_USERNAME;
  const password = process.env.SEED_OWNER_PASSWORD;
  const displayName = process.env.SEED_OWNER_DISPLAY_NAME ?? "Owner";

  if (!email || !password) {
    throw new Error("SEED_OWNER_EMAIL と SEED_OWNER_PASSWORD を設定してください");
  }

  if (!isStrongPassword(password)) {
    throw new Error("SEED_OWNER_PASSWORD は8文字以上で大文字・小文字・数字を含めてください");
  }

  const passwordHash = await hash(password, 10);
  const username = usernameEnv?.trim() || email.split("@")[0];

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      username,
      email,
      displayName,
      role: "OWNER",
      passwordHash,
      isActive: true
    }
  });

  console.log(`Seed completed for owner user: ${username}`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("Seed failed", error);
  process.exit(1);
});
