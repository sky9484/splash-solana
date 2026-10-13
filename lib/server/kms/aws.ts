import type { Kms, KmsContext } from './types';

/**
 * AWS KMS in ap-southeast-1 (Singapore): the target key service (decision 15). Built and tested with a
 * mocked client; not switched on. To switch on, see docs/security/PII-STORAGE.md: create the two keys,
 * install the SDK, set PII_KMS=aws and the two ARNs, re-wrap the local data keys, remove the local keys.
 *
 *   wrap / unwrap   Encrypt / Decrypt under PII_AWS_KMS_KEY_ARN (a symmetric key), with the company and
 *                   recipient as the encryption context, so a wrapped key moved to another company or
 *                   recipient fails to decrypt (and every use is in CloudTrail with that context).
 *   hmac            GenerateMac HMAC_SHA_256 under PII_AWS_HMAC_KEY_ARN (an HMAC key that never leaves KMS).
 *
 * Credentials come from the environment only (the SDK's default chain: the host's role, or
 * AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY). Nothing here reads or stores them.
 */

/** The three KMS calls used, shaped exactly like the SDK's command inputs and outputs. */
export interface AwsKmsPort {
  encrypt(input: { KeyId: string; Plaintext: Uint8Array; EncryptionContext: Record<string, string> }): Promise<{ CiphertextBlob?: Uint8Array; KeyId?: string }>;
  decrypt(input: { KeyId: string; CiphertextBlob: Uint8Array; EncryptionContext: Record<string, string> }): Promise<{ Plaintext?: Uint8Array; KeyId?: string }>;
  generateMac(input: { KeyId: string; Message: Uint8Array; MacAlgorithm: 'HMAC_SHA_256' }): Promise<{ Mac?: Uint8Array }>;
}

// A key id is a UUID, or mrk-<32 hex> for a multi-Region key.
const ARN = /^arn:aws:kms:([a-z0-9-]+):\d{12}:key\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|mrk-[0-9a-f]{32})$/;
export const PII_AWS_REGION = 'ap-southeast-1';

function regionOf(name: string, arn: string): string {
  const m = ARN.exec(arn.trim());
  if (!m) throw new Error(`${name} must be a KMS key ARN (arn:aws:kms:${PII_AWS_REGION}:<account>:key/<id>)`);
  if (m[1] !== PII_AWS_REGION) throw new Error(`${name} is in ${m[1]}; bank numbers are kept in ${PII_AWS_REGION} (decision 15)`);
  return m[1];
}

const contextOf = (c: KmsContext) => ({ purpose: 'splash-bank-number', org: c.orgId, beneficiary: c.beneficiaryId });

export function createAwsKms(opts: { keyArn: string; hmacKeyArn: string; port: AwsKmsPort | (() => Promise<AwsKmsPort>) }): Kms {
  regionOf('PII_AWS_KMS_KEY_ARN', opts.keyArn);
  regionOf('PII_AWS_HMAC_KEY_ARN', opts.hmacKeyArn);
  if (opts.keyArn.trim() === opts.hmacKeyArn.trim()) throw new Error('the wrapping key and the HMAC key must be two different KMS keys');
  let ready: Promise<AwsKmsPort> | null = null;
  const port = () => (ready ??= typeof opts.port === 'function' ? opts.port() : Promise.resolve(opts.port));
  const keyArn = opts.keyArn.trim();
  const hmacKeyArn = opts.hmacKeyArn.trim();
  return {
    kind: 'aws',
    keyId: () => keyArn,
    async wrap(dataKey, context) {
      if (dataKey.length !== 32) throw new Error('a data key is 32 bytes');
      const out = await (await port()).encrypt({ KeyId: keyArn, Plaintext: dataKey, EncryptionContext: contextOf(context) });
      if (!out.CiphertextBlob) throw new Error('KMS returned no ciphertext');
      return out.CiphertextBlob;
    },
    async unwrap(wrapped, context) {
      const out = await (await port()).decrypt({ KeyId: keyArn, CiphertextBlob: wrapped, EncryptionContext: contextOf(context) });
      if (!out.Plaintext || out.Plaintext.length !== 32) throw new Error('KMS returned no data key');
      return out.Plaintext;
    },
    async hmac(message) {
      const out = await (await port()).generateMac({ KeyId: hmacKeyArn, Message: message, MacAlgorithm: 'HMAC_SHA_256' });
      if (!out.Mac) throw new Error('KMS returned no MAC');
      return out.Mac;
    },
  };
}

/**
 * The SDK, loaded only when PII_KMS=aws and only on first use. It is not a dependency yet (nothing
 * uses it until the switch); installing it is a step in docs/security/PII-STORAGE.md. The import is
 * left to Node at runtime rather than bundled.
 */
async function sdkPort(region: string): Promise<AwsKmsPort> {
  const name = '@aws-sdk/client-kms';
  let sdk: {
    KMSClient: new (cfg: { region: string }) => { send(cmd: unknown): Promise<never> };
    EncryptCommand: new (i: unknown) => unknown;
    DecryptCommand: new (i: unknown) => unknown;
    GenerateMacCommand: new (i: unknown) => unknown;
  };
  try {
    sdk = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ name);
  } catch {
    throw new Error('PII_KMS=aws needs the AWS SDK: npm install @aws-sdk/client-kms (docs/security/PII-STORAGE.md)');
  }
  const client = new sdk.KMSClient({ region });
  return {
    encrypt: (input) => client.send(new sdk.EncryptCommand(input)),
    decrypt: (input) => client.send(new sdk.DecryptCommand(input)),
    generateMac: (input) => client.send(new sdk.GenerateMacCommand(input)),
  };
}

export function awsKmsFromEnv(source: NodeJS.ProcessEnv): Kms {
  const keyArn = source.PII_AWS_KMS_KEY_ARN?.trim();
  const hmacKeyArn = source.PII_AWS_HMAC_KEY_ARN?.trim();
  if (!keyArn || !hmacKeyArn) throw new Error('PII_KMS=aws needs PII_AWS_KMS_KEY_ARN and PII_AWS_HMAC_KEY_ARN');
  const region = regionOf('PII_AWS_KMS_KEY_ARN', keyArn);
  return createAwsKms({ keyArn, hmacKeyArn, port: () => sdkPort(region) });
}
