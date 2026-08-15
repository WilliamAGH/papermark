import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

import { ONE_HOUR, ONE_SECOND } from "@/lib/constants";
import { getS3Client } from "@/lib/files/aws-client";

const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_RENDERED_PAGE_BYTES = 20 * 1024 * 1024;
export const MAX_PUBLIC_IMAGE_BYTES = 5 * 1024 * 1024;
const S3_OPERATION_TIMEOUT_MS = 20_000;
const PUBLIC_IMAGE_PATH_PREFIX = "/api/file/public";
const TEAM_ID_PATTERN = "[a-z0-9]+";
const PUBLIC_IMAGE_FILENAME_PATTERN =
  "[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\\.(?:png|jpg)";
const PUBLIC_IMAGE_KEY_PATTERN = new RegExp(
  `^(${TEAM_ID_PATTERN})/public-assets/(${PUBLIC_IMAGE_FILENAME_PATTERN})$`,
);
const PUBLIC_IMAGE_URL_PATTERN = new RegExp(
  `^${PUBLIC_IMAGE_PATH_PREFIX}/(${TEAM_ID_PATTERN})/(${PUBLIC_IMAGE_FILENAME_PATTERN})$`,
);

export class StorageValidationError extends Error {}

type PublicImageContentType = "image/png" | "image/jpeg";
type PublicImageExtension = "png" | "jpg";

function requiredBucket(): string {
  const bucket = process.env.NEXT_PRIVATE_UPLOAD_BUCKET?.trim();
  if (!bucket) {
    throw new StorageValidationError("S3 bucket is not configured");
  }
  return bucket;
}

export function assertSafeStorageKey(key: string): string {
  const normalizedKey = key.trim();
  const segments = normalizedKey.split("/");

  if (
    !normalizedKey ||
    normalizedKey.length > 1_024 ||
    normalizedKey.startsWith("/") ||
    normalizedKey.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(normalizedKey) ||
    normalizedKey.includes("://") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new StorageValidationError("Invalid storage key");
  }

  return normalizedKey;
}

export function assertTeamStorageKey(key: string, teamId: string): string {
  const safeKey = assertSafeStorageKey(key);
  if (!teamId || !safeKey.startsWith(`${teamId}/`)) {
    throw new StorageValidationError(
      "Storage key is outside the team namespace",
    );
  }
  return safeKey;
}

function publicImageParts(key: string) {
  const safeKey = assertSafeStorageKey(key);
  const match = PUBLIC_IMAGE_KEY_PATTERN.exec(safeKey);
  if (!match) {
    throw new StorageValidationError("Invalid public image key");
  }

  return {
    key: safeKey,
    teamId: match[1],
    filename: match[2],
  };
}

function assertPublicImageKey(key: string, teamId?: string): string {
  const publicImage = publicImageParts(key);
  if (teamId && publicImage.teamId !== teamId) {
    throw new StorageValidationError(
      "Public image key is outside the team namespace",
    );
  }
  return publicImage.key;
}

export function publicImageKeyFromRoute(
  teamId: string,
  filename: string,
): string {
  return assertPublicImageKey(`${teamId}/public-assets/${filename}`, teamId);
}

export function publicImageUrl(key: string): string {
  const { teamId, filename } = publicImageParts(key);
  return `${PUBLIC_IMAGE_PATH_PREFIX}/${teamId}/${filename}`;
}

export function publicImageKeyFromUrl(
  url: string,
  teamId: string,
): string | null {
  const match = PUBLIC_IMAGE_URL_PATTERN.exec(url);
  if (!match || match[1] !== teamId) {
    return null;
  }

  try {
    return publicImageKeyFromRoute(match[1], match[2]);
  } catch {
    return null;
  }
}

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), S3_OPERATION_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

export async function signStoredObject(key: string): Promise<string> {
  const safeKey = assertSafeStorageKey(key);
  return getSignedUrl(
    getS3Client({ publicEndpoint: true }),
    new GetObjectCommand({ Bucket: requiredBucket(), Key: safeKey }),
    { expiresIn: ONE_HOUR / ONE_SECOND },
  );
}

export async function signPublicImage(key: string): Promise<string> {
  const safeKey = assertPublicImageKey(key);
  return getSignedUrl(
    getS3Client({ publicEndpoint: true }),
    new GetObjectCommand({ Bucket: requiredBucket(), Key: safeKey }),
    { expiresIn: ONE_HOUR / ONE_SECOND },
  );
}

export async function deleteOwnedObject(
  key: string,
  teamId: string,
): Promise<void> {
  const safeKey = assertTeamStorageKey(key, teamId);
  try {
    await withTimeout((abortSignal) =>
      getS3Client().send(
        new DeleteObjectCommand({ Bucket: requiredBucket(), Key: safeKey }),
        { abortSignal },
      ),
    );
  } catch {
    throw new StorageValidationError("Failed to clean up stored object");
  }
}

function publicImageFormat(
  contentType: string,
  image: Uint8Array,
): { contentType: PublicImageContentType; extension: PublicImageExtension } {
  if (!image.byteLength || image.byteLength > MAX_PUBLIC_IMAGE_BYTES) {
    throw new StorageValidationError(
      "Public image size is outside allowed bounds",
    );
  }

  const isPng =
    image.byteLength >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => image[index] === byte,
    );
  if (contentType === "image/png" && isPng) {
    return { contentType, extension: "png" };
  }

  const isJpeg =
    image.byteLength >= 3 &&
    image[0] === 0xff &&
    image[1] === 0xd8 &&
    image[2] === 0xff;
  if (contentType === "image/jpeg" && isJpeg) {
    return { contentType, extension: "jpg" };
  }

  throw new StorageValidationError(
    "Public images must be PNG or JPEG files with a matching MIME type",
  );
}

export async function storePublicImage({
  teamId,
  contentType,
  image,
}: {
  teamId: string;
  contentType: string;
  image: Uint8Array;
}): Promise<string> {
  const format = publicImageFormat(contentType, image);
  const key = assertPublicImageKey(
    `${teamId}/public-assets/${randomUUID()}.${format.extension}`,
    teamId,
  );

  await withTimeout((abortSignal) =>
    getS3Client().send(
      new PutObjectCommand({
        Bucket: requiredBucket(),
        Key: key,
        Body: image,
        ContentType: format.contentType,
        CacheControl: "public, max-age=31536000, immutable",
        IfNoneMatch: "*",
      }),
      { abortSignal },
    ),
  );
  return key;
}

export async function readOwnedPdf(
  key: string,
  teamId: string,
): Promise<Uint8Array> {
  const safeKey = assertTeamStorageKey(key, teamId);
  const client = getS3Client();
  const bucket = requiredBucket();

  const metadata = await withTimeout((abortSignal) =>
    client.send(new HeadObjectCommand({ Bucket: bucket, Key: safeKey }), {
      abortSignal,
    }),
  );
  const contentLength = metadata.ContentLength ?? 0;
  const contentType = metadata.ContentType?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/pdf") {
    throw new StorageValidationError("Stored document is not a PDF");
  }
  if (contentLength < 5 || contentLength > MAX_PDF_BYTES) {
    throw new StorageValidationError(
      "Stored PDF size is outside allowed bounds",
    );
  }

  const bytes = await withTimeout(async (abortSignal) => {
    const object = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: safeKey }),
      { abortSignal },
    );
    if (!object.Body) {
      throw new StorageValidationError("Stored PDF has no body");
    }
    return object.Body.transformToByteArray();
  });

  if (bytes.byteLength !== contentLength || bytes.byteLength > MAX_PDF_BYTES) {
    throw new StorageValidationError("Stored PDF body has an invalid size");
  }
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new StorageValidationError("Stored object does not contain a PDF");
  }
  return bytes;
}

export async function writeRenderedPage({
  key,
  teamId,
  png,
}: {
  key: string;
  teamId: string;
  png: Uint8Array;
}): Promise<string> {
  const safeKey = assertTeamStorageKey(key, teamId);
  if (!png.byteLength || png.byteLength > MAX_RENDERED_PAGE_BYTES) {
    throw new StorageValidationError(
      "Rendered page size is outside allowed bounds",
    );
  }
  if (
    png.byteLength < 8 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => png[index] === byte,
    )
  ) {
    throw new StorageValidationError("Rendered page is not a PNG");
  }

  await withTimeout((abortSignal) =>
    getS3Client().send(
      new PutObjectCommand({
        Bucket: requiredBucket(),
        Key: safeKey,
        Body: png,
        ContentType: "image/png",
      }),
      { abortSignal },
    ),
  );
  return safeKey;
}
