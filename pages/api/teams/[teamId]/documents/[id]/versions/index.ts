import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import prisma from "@/lib/prisma";
import { log } from "@/lib/utils";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { CustomUser } from "@/lib/types";
import { getTeamWithUsersAndDocument } from "@/lib/team/helper";
import { DocumentStorageType } from "@prisma/client";
import { processDocumentVersion } from "@/lib/documents/process-document-version";

export const config = { maxDuration: 300 };

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "POST") {
    // GET /api/teams/:teamId/documents/:id/versions
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    // get document id from query params
    const { teamId, id: documentId } = req.query as {
      teamId: string;
      id: string;
    };
    const { url, type, numPages, storageType } = req.body as {
      url: string;
      type: string;
      numPages: number;
      storageType: DocumentStorageType;
    };

    const userId = (session.user as CustomUser).id;

    try {
      const { document } = await getTeamWithUsersAndDocument({
        teamId,
        userId,
        docId: documentId,
        checkOwner: true,
        options: {
          select: {
            id: true,
            versions: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { versionNumber: true },
            },
            links: { select: { id: true } },
          },
        },
      });

      // get the latest version number for this document
      // const result = await prisma.document.findUnique({
      //   where: {
      //     id: documentId,
      //   },
      //   select: {
      //     versions: {
      //       orderBy: { createdAt: "desc" },
      //       take: 1,
      //       select: { versionNumber: true },
      //     },
      //   },
      // });

      // create a new document version
      const currentVersionNumber = document?.versions
        ? document.versions[0].versionNumber
        : 1;
      const version = await prisma.documentVersion.create({
        data: {
          documentId: documentId,
          file: url,
          type: type,
          storageType,
          numPages: numPages,
          isPrimary: false,
          versionNumber: currentVersionNumber + 1,
        },
      });

      try {
        await processDocumentVersion({
          documentVersionId: version.id,
          documentId,
          teamId,
        });
        await Promise.allSettled(
          (document?.links ?? []).map((link) =>
            res.revalidate(`/view/${link.id}`),
          ),
        );
      } catch (processingError) {
        await prisma.documentVersion.delete({ where: { id: version.id } });
        throw new Error(
          `Document processing failed: ${(processingError as Error).message}`,
        );
      }

      res.status(200).json({ id: documentId });
    } catch (error) {
      log({
        message: `Failed to create new version for document: _${documentId}_. \n\n ${error} \n\n*Metadata*: \`{teamId: ${teamId}, userId: ${userId}}\``,
        type: "error",
      });
      return res.status(500).json({
        message: "Internal Server Error",
        error: (error as Error).message,
      });
    }
  } else {
    // We only allow GET requests
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
