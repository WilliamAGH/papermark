import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";

import { authOptions } from "../../auth/[...nextauth]";
import {
  assertTeamStorageKey,
  signStoredObject,
  StorageValidationError,
} from "@/lib/files/s3-security";
import { CustomUser } from "@/lib/types";
import prisma from "@/lib/prisma";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).end("Method Not Allowed");
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).end("Unauthorized");
  }

  const { key, teamId, documentId, documentVersionId } = req.body as {
    key?: string;
    teamId?: string;
    documentId?: string;
    documentVersionId?: string;
  };
  if (!key || !teamId || !documentId) {
    return res.status(400).json({ error: "Missing storage ownership fields" });
  }

  try {
    const safeKey = assertTeamStorageKey(key, teamId);
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        teamId,
        team: {
          users: { some: { userId: (session.user as CustomUser).id } },
        },
      },
      select: {
        file: true,
        versions: {
          ...(documentVersionId ? { where: { id: documentVersionId } } : {}),
          select: { id: true, file: true, pages: { select: { file: true } } },
        },
      },
    });
    if (!document) {
      return res.status(403).end("Forbidden");
    }
    const versionOwnsKey = document.versions.some(
      (version) =>
        version.file === safeKey ||
        version.pages.some((page) => page.file === safeKey),
    );
    const ownsKey = documentVersionId
      ? versionOwnsKey
      : document.file === safeKey || versionOwnsKey;
    if (!ownsKey) {
      return res.status(403).end("Forbidden");
    }

    return res.status(200).json({ url: await signStoredObject(safeKey) });
  } catch (error) {
    if (error instanceof StorageValidationError) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: "Unable to sign stored file" });
  }
}
