import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getKey() {
  const secret = process.env.APP_ENCRYPTION_KEY;

  if (!secret) {
    throw new Error("APP_ENCRYPTION_KEY is required to encrypt model API keys.");
  }

  return createHash("sha256").update(secret).digest();
}

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

export function encryptSecret(value: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret) {
  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(secret.iv, "base64"),
  );

  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

