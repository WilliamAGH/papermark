import { NextApiRequest, NextApiResponse } from "next";

import { hasValidInternalApiKey } from "@/lib/api/internal-api-auth";
import { processOwnedPdfPage } from "@/lib/documents/process-document-version";

// This function can run for a maximum of 60 seconds
export const config = {
  maxDuration: 120,
};

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

  const { documentVersionId, pageNumber, teamId, documentId } = req.body as {
    documentVersionId?: string;
    pageNumber?: number;
    teamId?: string;
    documentId?: string;
  };
  if (!documentVersionId || !teamId || !Number.isInteger(pageNumber)) {
    return res.status(400).json({ error: "Invalid document page request" });
  }

  try {
    const documentPage = await processOwnedPdfPage({
      documentVersionId,
      pageNumber: pageNumber!,
      teamId,
      documentId,
    });
    return res.status(200).json({ documentPageId: documentPage.id });
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
}
