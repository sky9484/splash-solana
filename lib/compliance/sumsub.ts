import { createHmac } from 'crypto';

export type SumsubKybSessionInput = {
  kybCaseId: string;
  businessName: string;
  registrationNumber: string;
};

export type SumsubKybSession = {
  provider: 'SUMSUB';
  applicantId: string | null;
  externalUserId: string;
  levelName: string;
  accessToken: string;
  expiresAt: string;
};

type SumsubConfig = {
  baseUrl: string;
  appToken: string;
  secretKey: string;
  levelName: string;
};

type SumsubApplicantResponse = {
  id?: string;
};

type SumsubAccessTokenResponse = {
  token: string;
};

export function getSumsubConfig() {
  const appToken = process.env.SUMSUB_APP_TOKEN;
  const secretKey = process.env.SUMSUB_SECRET_KEY;
  const levelName = process.env.SUMSUB_LEVEL_NAME ?? 'splash-kyb';

  if (!appToken || !secretKey) {
    return null;
  }

  return {
    baseUrl: process.env.SUMSUB_BASE_URL ?? 'https://api.sumsub.com',
    appToken,
    secretKey,
    levelName,
  } satisfies SumsubConfig;
}

async function sumsubRequest<T>(config: SumsubConfig, method: 'POST' | 'GET', path: string, body?: unknown) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = body ? JSON.stringify(body) : '';
  const signature = createHmac('sha256', config.secretKey)
    .update(`${timestamp}${method}${path}${payload}`)
    .digest('hex');

  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-App-Token': config.appToken,
      'X-App-Access-Sig': signature,
      'X-App-Access-Ts': timestamp,
    },
    body: payload || undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sumsub request failed (${response.status}): ${text || response.statusText}`);
  }

  return (await response.json()) as T;
}

export async function createSumsubKybSession(input: SumsubKybSessionInput): Promise<SumsubKybSession> {
  const config = getSumsubConfig();

  if (!config) {
    throw new Error('Sumsub is not configured');
  }

  const externalUserId = input.kybCaseId;
  let applicantId: string | null = null;

  try {
    const applicantPath = `/resources/applicants?levelName=${encodeURIComponent(config.levelName)}`;
    const applicant = await sumsubRequest<SumsubApplicantResponse>(config, 'POST', applicantPath, {
      externalUserId,
      type: 'company',
      fixedInfo: {
        companyInfo: {
          companyName: input.businessName,
          registrationNumber: input.registrationNumber,
        },
      },
    });
    applicantId = applicant.id ?? null;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('409')) {
      throw error;
    }
  }

  const ttlSeconds = 600;
  const tokenPath = `/resources/accessTokens?userId=${encodeURIComponent(externalUserId)}&levelName=${encodeURIComponent(config.levelName)}&ttlInSecs=${ttlSeconds}`;
  const token = await sumsubRequest<SumsubAccessTokenResponse>(config, 'POST', tokenPath);

  return {
    provider: 'SUMSUB',
    applicantId,
    externalUserId,
    levelName: config.levelName,
    accessToken: token.token,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };
}
