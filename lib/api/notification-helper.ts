async function postNotificationJob(
  path: string,
  body: Record<string, string>,
): Promise<void> {
  let response: Response;

  try {
    response = await fetch(`${process.env.NEXTAUTH_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Notification request failed.");
  }

  if (!response.ok) {
    throw new Error(
      `Notification request failed with status ${response.status}.`,
    );
  }
}

export default async function sendNotification({ viewId }: { viewId: string }) {
  await postNotificationJob("/api/jobs/send-notification", { viewId });
}

export async function sendViewerInvitation({
  dataroomId,
  linkId,
  viewerIds,
  senderUserId,
}: {
  dataroomId: string;
  linkId: string;
  viewerIds: string[];
  senderUserId: string;
}) {
  for (const viewerId of viewerIds) {
    await postNotificationJob("/api/jobs/send-dataroom-view-invitation", {
      dataroomId,
      linkId,
      viewerId,
      senderUserId,
    });
  }
}
