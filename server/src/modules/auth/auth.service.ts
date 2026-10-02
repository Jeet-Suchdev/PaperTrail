import argon2 from 'argon2';
import type { User, Wallet } from '../../generated/prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { numberToPaise } from '../../lib/money';

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

// Verified when the email is unknown, so a login attempt does the same
// hash work either way — response timing can't reveal which emails exist.
// Computed once at module load (top-level await).
const DUMMY_HASH = await argon2.hash('papertrail-timing-equalizer-not-a-real-password', {
  type: argon2.argon2id,
});

// One transaction: if any step fails (including the unique-email
// constraint), the whole thing rolls back — no wallet without a user,
// no ledger entry without a wallet.
export async function register(input: RegisterInput): Promise<{ user: User; wallet: Wallet }> {
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const startingPaise = numberToPaise(env.STARTING_BALANCE_PAISE);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name: input.name, email: input.email, passwordHash },
    });
    const wallet = await tx.wallet.create({
      data: { userId: user.id, cashPaise: startingPaise },
    });
    await tx.ledgerEntry.create({
      data: {
        userId: user.id,
        type: 'INITIAL_CREDIT',
        amountPaise: startingPaise,
        balanceAfterPaise: startingPaise,
      },
    });
    return { user, wallet };
  });
}

// Unknown email and wrong password throw the identical error so neither
// can be used to enumerate accounts. Duplicate emails surface as Prisma
// P2002 and are mapped to 409 by the central error handler.
export async function login(email: string, password: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email } });
  const isValid = await argon2.verify(user?.passwordHash ?? DUMMY_HASH, password);
  if (user === null || !isValid) {
    throw new AppError('AUTH_FAILED', 'Authentication failed', 401);
  }
  return user;
}

// The single query behind GET /me: user + wallet in one round trip.
// Returns null when either is missing so the route can send a 401.
export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { wallet: true },
  });
  if (user === null || user.wallet === null) {
    return null;
  }
  return { user, wallet: user.wallet };
}
