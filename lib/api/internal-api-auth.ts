import { timingSafeEqual } from "node:crypto";
import { NextApiRequest } from "next";

export function hasValidInternalApiKey(req: NextApiRequest | Request): boolean {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected || expected.length < 32) {
    return false;
  }

  const authorization =
    req.headers instanceof Headers
      ? req.headers.get("authorization")
      : req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }
  const provided = authorization.slice("Bearer ".length);
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}
