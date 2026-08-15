export const getPagesCount = async (arrayBuffer: ArrayBuffer) => {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument(arrayBuffer).promise;
  return pdf.numPages;
};
