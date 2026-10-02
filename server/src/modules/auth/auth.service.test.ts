import { beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { login, register } from './auth.service';

const EMAIL = 'alice@papertrail.test';
const PASSWORD = 'correct-horse-battery';

function registerAlice(email: string = EMAIL) {
  return register({ name: 'Alice', email, password: PASSWORD });
}

// One statement truncates all three tables as a unit; listing every table
// satisfies Postgres' FK rule without needing CASCADE.
async function resetDb() {
  await prisma.$executeRaw`TRUNCATE TABLE "LedgerEntry", "Wallet", "User"`;
}

beforeEach(async () => {
  await resetDb();
});

describe('register', () => {
  it('creates user, wallet, and INITIAL_CREDIT ledger entry', async () => {
    const { user, wallet } = await registerAlice();

    const foundUser = await prisma.user.findUnique({ where: { id: user.id } });
    const foundWallet = await prisma.wallet.findUnique({ where: { id: wallet.id } });
    const entries = await prisma.ledgerEntry.findMany({ where: { userId: user.id } });

    expect(foundUser).not.toBeNull();
    expect(foundUser?.email).toBe(EMAIL);
    expect(foundWallet).not.toBeNull();
    expect(foundWallet?.userId).toBe(user.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe('INITIAL_CREDIT');
    expect(entries[0]?.userId).toBe(user.id);
  });

  it('starts the wallet at 100000000n paise which equals the ledger sum', async () => {
    const { user, wallet } = await registerAlice();

    const entries = await prisma.ledgerEntry.findMany({ where: { userId: user.id } });
    const ledgerSum = entries.reduce((sum, entry) => sum + entry.amountPaise, 0n);

    expect(wallet.cashPaise).toBe(100000000n);
    expect(wallet.cashPaise).toBe(ledgerSum);
  });

  it('stores an argon2id hash of the password, never the plaintext', async () => {
    const { user } = await registerAlice();

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(row.passwordHash).not.toBe(PASSWORD);
    expect(row.passwordHash).not.toContain(PASSWORD);
  });

  it('rejects a duplicate email with Prisma P2002 (error handler maps it to 409)', async () => {
    await registerAlice();

    const err = await registerAlice().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((err as InstanceType<typeof Prisma.PrismaClientKnownRequestError>).code).toBe('P2002');
  });

  it('lets exactly one of two concurrent same-email registrations win', async () => {
    const results = await Promise.allSettled([registerAlice(), registerAlice()]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const reason = (rejected[0] as PromiseRejectedResult).reason as InstanceType<
      typeof Prisma.PrismaClientKnownRequestError
    >;
    expect(reason).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(reason.code).toBe('P2002');

    // Exactly one row in the database — the loser's whole transaction
    // rolled back, so no orphan wallet or ledger rows either.
    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(1);
    const winner = (fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof register>>>)
      .value;
    expect(await prisma.wallet.count({ where: { userId: winner.user.id } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { userId: winner.user.id } })).toBe(1);
  });
});

describe('login', () => {
  it('returns the user for correct credentials', async () => {
    const { user } = await registerAlice();

    const found = await login(EMAIL, PASSWORD);

    expect(found.id).toBe(user.id);
    expect(found.email).toBe(EMAIL);
  });

  it('returns the identical generic error for wrong password and unknown email', async () => {
    await registerAlice();

    const wrongPassword = await login(EMAIL, 'not-the-password').catch((e: unknown) => e);
    const unknownEmail = await login('mallory@papertrail.test', PASSWORD).catch((e: unknown) => e);

    expect(wrongPassword).toBeInstanceOf(AppError);
    expect(unknownEmail).toBeInstanceOf(AppError);

    const a = wrongPassword as AppError;
    const b = unknownEmail as AppError;
    expect(a.code).toBe('AUTH_FAILED');
    expect(b.code).toBe('AUTH_FAILED');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.message).toBe(b.message);
  });
});
