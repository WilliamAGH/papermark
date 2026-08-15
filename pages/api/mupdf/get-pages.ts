import { NextApiRequest, NextApiResponse } from "next";

import { hasValidInternalApiKey } from "@/lib/api/internal-api-auth";
import { getOwnedPdfPageCount } from "@/lib/documents/process-document-version";

export const config = { maxDuration: 120 };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  if (!hasValidInternalApiKey(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { documentVersionId, teamId, documentId } = req.body as {
    documentVersionId?: string;
    teamId?: string;
    documentId?: string;
  };
  if (!documentVersionId || !teamId) {
    return res.status(400).json({ error: "Missing document ownership fields" });
  }

  try {
    const numPages = await getOwnedPdfPageCount({
      documentVersionId,
      teamId,
      documentId,
    });
    return res.status(200).json({ numPages });
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
}
