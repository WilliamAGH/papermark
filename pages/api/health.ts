import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ status: "error" });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;

    if (req.method === "HEAD") {
      return res.status(200).end();
    }

    return res.json({
      status: "ok",
    });
  } catch (err) {
    console.error("Database readiness check failed", err);

    return res.status(503).json({
      status: "error",
    });
  }
}
