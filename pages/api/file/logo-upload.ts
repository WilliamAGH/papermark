import type { NextApiResponse, NextApiRequest } from "next";
import { getServerSession } from "next-auth/next";
import prisma from "@/lib/prisma";
import {
  MAX_PUBLIC_IMAGE_BYTES,
  publicImageUrl,
  StorageValidationError,
  storePublicImage,
} from "@/lib/files/s3-security";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { CustomUser } from "@/lib/types";

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readImage(req: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > MAX_PUBLIC_IMAGE_BYTES) {
      throw new StorageValidationError(
        "Public image size is outside allowed bounds",
      );
    }
    chunks.push(bytes);
  }

  return Buffer.concat(chunks);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).end("Unauthorized");
  }

  const teamId = typeof req.query.teamId === "string" ? req.query.teamId : "";
  const userId = (session.user as CustomUser).id;
  if (!teamId || !userId) {
    return res.status(400).json({ error: "A team is required" });
  }

  try {
    const team = await prisma.team.findFirst({
      where: {
        id: teamId,
        users: {
          some: {
            userId,
          },
        },
      },
      select: { id: true },
    });
    if (!team) {
      return res.status(403).end("Unauthorized to access this team");
    }

    const contentType = req.headers["content-type"];
    if (typeof contentType !== "string") {
      return res.status(400).json({ error: "An image MIME type is required" });
    }

    const key = await storePublicImage({
      teamId,
      contentType,
      image: await readImage(req),
    });
    return res.status(201).json({ url: publicImageUrl(key) });
  } catch (error) {
    if (error instanceof StorageValidationError) {
      return res.status(400).json({ error: error.message });
    }

    console.error("Failed to upload public image", error);
    return res.status(500).json({ error: "Unable to upload image" });
  }
}
