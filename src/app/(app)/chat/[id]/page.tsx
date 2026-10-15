import { notFound } from "next/navigation";
import { z } from "zod";
import { getOwner } from "@/server/auth/session";
import { getChat } from "@/server/chat/repo";
import { ChatView } from "@/components/chat/chat-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const owner = await getOwner();
  if (!owner || !z.uuid().safeParse(id).success) return { title: "Flight Deck" };

  try {
    const chat = await getChat(id, owner.userId);
    return { title: `${chat.title} — Flight Deck` };
  } catch {
    return { title: "Flight Deck" };
  }
}

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  // Ownership is verified here so a bad id 404s on the server rather than
  // flashing an empty chat and then erroring in the client.
  const owner = await getOwner();
  if (!owner) notFound();

  try {
    await getChat(id, owner.userId);
  } catch {
    notFound();
  }

  return <ChatView chatId={id} />;
}
