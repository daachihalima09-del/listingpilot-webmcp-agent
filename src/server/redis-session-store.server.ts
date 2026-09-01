import 'server-only';

import { randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { CHALLENGE_SESSION_TTL_SECONDS } from '@/session/challenge-session';
import { ChallengeError, type ChallengeErrorCode } from './errors';

export interface SessionStore {
  get(key: string): Promise<string | null>;
  create(key: string, value: string): Promise<boolean>;
  compareAndSet(key: string, expected: string, value: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export interface RedisSessionClient {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, options: { nx: true; ex: number }): Promise<unknown>;
  eval(script: string, keys: string[], args: Array<string | number>): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

type RedisCommand = 'GET' | 'SET_NX_EX' | 'EVAL_CAS' | 'DEL';

const compareAndSetScript = "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1 else return 0 end";

function classifiedRedisError(error: unknown, command: RedisCommand): ChallengeError {
  const reference = randomUUID();
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  let code: ChallengeErrorCode = 'REDIS_COMMAND_FAILED';
  let merchantMessage = 'Challenge persistence is temporarily unavailable.';

  if (/\bnoperm\b|no permissions|permission denied|forbidden|status[^0-9]*403/.test(message)) {
    code = 'REDIS_PERMISSION_DENIED';
    merchantMessage = 'Challenge persistence does not have write permission. Configure the write-enabled Redis REST token.';
  } else if (/\bwrongpass\b|unauthori[sz]ed|invalid (?:api )?token|status[^0-9]*401|authentication/.test(message)) {
    code = 'REDIS_AUTHENTICATION_FAILED';
    merchantMessage = 'Challenge persistence authentication failed. Verify the Redis REST credentials.';
  } else if (/unknown command.*eval|eval.*not (?:allowed|supported)|scripting.*disabled|command.*unsupported/.test(message)) {
    code = 'REDIS_COMMAND_UNSUPPORTED';
    merchantMessage = 'Challenge persistence does not support the required atomic command.';
  } else if (/fetch failed|network|econn|enotfound|timed? ?out|socket|dns|connection/.test(message)) {
    code = 'REDIS_CONNECTION_FAILED';
    merchantMessage = 'Challenge persistence could not be reached. Try again shortly.';
  }

  console.error('Challenge Redis command failed.', {
    event: 'challenge.redis.command_failed', reference, command, code,
    errorName: error instanceof Error ? error.name : typeof error,
  });
  return new ChallengeError(code, merchantMessage, 503, reference);
}

async function runRedisCommand<T>(command: RedisCommand, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ChallengeError) throw error;
    throw classifiedRedisError(error, command);
  }
}

export function createRedisSessionStore(client: RedisSessionClient): SessionStore {
  return {
    get: async (key) => runRedisCommand('GET', async () => {
      const value = await client.get(key);
      if (value !== null && typeof value !== 'string') {
        throw new Error('Redis GET returned an incompatible response type.');
      }
      return value;
    }),
    create: async (key, value) => runRedisCommand('SET_NX_EX', async () =>
      (await client.set(key, value, { nx: true, ex: CHALLENGE_SESSION_TTL_SECONDS })) === 'OK'),
    compareAndSet: async (key, expected, value) => runRedisCommand('EVAL_CAS', async () =>
      (await client.eval(compareAndSetScript, [key], [expected, value, CHALLENGE_SESSION_TTL_SECONDS])) === 1),
    delete: async (key) => runRedisCommand('DEL', async () => { await client.del(key); }),
  };
}

export function createProductionRedisSessionStore(): SessionStore {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  let parsedUrl: URL;
  try {
    if (!url || !token) throw new Error('missing');
    parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:') throw new Error('protocol');
  } catch {
    throw new ChallengeError('REDIS_CONFIGURATION_INVALID', 'Challenge persistence is not configured correctly.', 503);
  }
  const redis = new Redis({ url: parsedUrl.toString(), token });
  return createRedisSessionStore(redis as unknown as RedisSessionClient);
}

export const redisSessionCommands = ['GET', 'SET NX EX', 'EVAL (GET + SET EX)', 'DEL'] as const;
