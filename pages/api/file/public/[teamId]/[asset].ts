import type { NextApiRequest, NextApiResponse } from "next";
import {
  publicImageKeyFromRoute,
  signPublicImage,
  StorageValidationError,
} from "@/lib/files/s3-security";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { teamId, asset } = req.query;
  if (typeof teamId !== "string" || typeof asset !== "string") {
    return res.status(404).end();
  }

  let key: string;
  try {
    key = publicImageKeyFromRoute(teamId, asset);
  } catch (error) {
    if (error instanceof StorageValidationError) {
      return res.status(404).end();
    }
    throw error;
  }

  try {
    const url = await signPublicImage(key);
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(307, url);
  } catch (error) {
    console.error("Failed to serve public image", error);
    return res.status(500).end("Unable to serve image");
  }
}
