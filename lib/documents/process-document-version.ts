import { DocumentStorageType } from "@prisma/client";

import prisma from "@/lib/prisma";
import {
  deleteOwnedObject,
  readOwnedPdf,
  writeRenderedPage,
} from "@/lib/files/s3-security";

// mupdf 0.1.3 does not publish TypeScript declarations.
// @ts-ignore
import mupdf from "mupdf";

const MAX_PDF_PAGES = 500;
const PDF_RENDER_SCALE = 216 / 72;
// Keep one RGB pixmap near 120 MB before PNG encoding while allowing large pages.
const MAX_RENDERED_PAGE_PIXELS = 40_000_000;

type ProcessingTarget = {
  documentVersionId: string;
  teamId: string;
  documentId?: string;
};

async function loadTarget({
  documentVersionId,
  teamId,
  documentId,
}: ProcessingTarget) {
  const version = await prisma.documentVersion.findFirst({
    where: {
      id: documentVersionId,
      ...(documentId ? { documentId } : {}),
      document: { teamId },
    },
    select: {
      id: true,
      documentId: true,
      file: true,
      storageType: true,
      versionNumber: true,
    },
  });
  if (!version) {
    throw new Error("Document version is not owned by the requested team");
  }
  if (version.storageType !== DocumentStorageType.S3_PATH) {
    throw new Error("Self-hosted PDF processing requires S3 storage");
  }
  return version;
}

async function openOwnedPdf(target: ProcessingTarget) {
  const version = await loadTarget(target);
  const bytes = await readOwnedPdf(version.file, target.teamId);
  const document = mupdf.Document.openDocument(bytes, "application/pdf");
  const pageCount = document.countPages();
  if (pageCount < 1 || pageCount > MAX_PDF_PAGES) {
    document.destroy();
    throw new Error("PDF page count is outside allowed bounds");
  }
  return { document, pageCount, version };
}

function assertRenderPixelBudget(bounds: unknown): void {
  if (
    !Array.isArray(bounds) ||
    bounds.length !== 4 ||
    !bounds.every((coordinate) => Number.isFinite(coordinate))
  ) {
    throw new Error("PDF page bounds are invalid");
  }

  const [x0, y0, x1, y1] = bounds as [number, number, number, number];
  const pixelWidth =
    Math.ceil(Math.max(x0, x1) * PDF_RENDER_SCALE) -
    Math.floor(Math.min(x0, x1) * PDF_RENDER_SCALE);
  const pixelHeight =
    Math.ceil(Math.max(y0, y1) * PDF_RENDER_SCALE) -
    Math.floor(Math.min(y0, y1) * PDF_RENDER_SCALE);
  const pixelCount = pixelWidth * pixelHeight;

  if (
    pixelWidth < 1 ||
    pixelHeight < 1 ||
    !Number.isSafeInteger(pixelCount) ||
    pixelCount > MAX_RENDERED_PAGE_PIXELS
  ) {
    throw new Error("PDF page render size is outside allowed bounds");
  }
}

export async function getOwnedPdfPageCount(
  target: ProcessingTarget,
): Promise<number> {
  const { document, pageCount } = await openOwnedPdf(target);
  document.destroy();
  return pageCount;
}

async function renderAndStorePage({
  document,
  pageNumber,
  teamId,
  documentId,
  documentVersionId,
}: {
  document: any;
  pageNumber: number;
  teamId: string;
  documentId: string;
  documentVersionId: string;
}) {
  const page = document.loadPage(pageNumber - 1);
  let pixmap: any;
  try {
    assertRenderPixelBudget(page.getBounds());
    const embeddedLinks = page
      .getLinks()
      .map((link: { getURI: () => string }) => link.getURI());
    pixmap = page.toPixmap(
      mupdf.Matrix.scale(PDF_RENDER_SCALE, PDF_RENDER_SCALE),
      mupdf.ColorSpace.DeviceRGB,
      false,
      true,
    );
    const key = await writeRenderedPage({
      key: `${teamId}/${documentId}/${documentVersionId}/page-${pageNumber}.png`,
      teamId,
      png: pixmap.asPNG(),
    });
    try {
      const documentPage = await prisma.documentPage.upsert({
        where: {
          pageNumber_versionId: { pageNumber, versionId: documentVersionId },
        },
        create: {
          versionId: documentVersionId,
          pageNumber,
          file: key,
          storageType: DocumentStorageType.S3_PATH,
          embeddedLinks,
        },
        update: {
          file: key,
          storageType: DocumentStorageType.S3_PATH,
          embeddedLinks,
        },
        select: { id: true },
      });
      return { documentPage, key };
    } catch (processingError) {
      try {
        await deleteOwnedObject(key, teamId);
      } catch (cleanupError) {
        throw new AggregateError(
          [processingError, cleanupError],
          "Document page processing and cleanup failed",
        );
      }
      throw processingError;
    }
  } finally {
    pixmap?.destroy();
    page.destroy();
  }
}

export async function processOwnedPdfPage(
  target: ProcessingTarget & { pageNumber: number },
) {
  const { document, pageCount, version } = await openOwnedPdf(target);
  try {
    if (
      !Number.isInteger(target.pageNumber) ||
      target.pageNumber < 1 ||
      target.pageNumber > pageCount
    ) {
      throw new Error("Page number is outside the document bounds");
    }
    const { documentPage } = await renderAndStorePage({
      document,
      pageNumber: target.pageNumber,
      teamId: target.teamId,
      documentId: version.documentId,
      documentVersionId: version.id,
    });
    return documentPage;
  } finally {
    document.destroy();
  }
}

export async function processDocumentVersion(target: ProcessingTarget) {
  const { document, pageCount, version } = await openOwnedPdf(target);
  const renderedKey: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const renderedPage = await renderAndStorePage({
        document,
        pageNumber,
        teamId: target.teamId,
        documentId: version.documentId,
        documentVersionId: version.id,
      });
      renderedKey.push(renderedPage.key);
    }

    await prisma.$transaction([
      prisma.documentVersion.updateMany({
        where: { documentId: version.documentId, id: { not: version.id } },
        data: { isPrimary: false },
      }),
      prisma.documentVersion.update({
        where: { id: version.id },
        data: { hasPages: true, isPrimary: true, numPages: pageCount },
      }),
      prisma.document.update({
        where: { id: version.documentId },
        data: { numPages: pageCount },
      }),
    ]);

    return { documentId: version.documentId, pageCount };
  } catch (processingError) {
    const cleanupResult = await Promise.allSettled(
      [version.file, ...renderedKey].map((key) =>
        deleteOwnedObject(key, target.teamId),
      ),
    );
    const cleanupError = cleanupResult
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map((result) => result.reason);
    if (cleanupError.length > 0) {
      throw new AggregateError(
        [processingError, ...cleanupError],
        "Document processing and cleanup failed",
      );
    }
    throw processingError;
  } finally {
    document.destroy();
  }
}
