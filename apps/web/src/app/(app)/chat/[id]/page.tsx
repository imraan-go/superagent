import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getChatTitle } from '@/server/api';
import { ChatView } from '@/components/chat/chat-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return { title: 'Superagent' };
  const title = await getChatTitle(id);
  return { title: title ? `${title} — Superagent` : 'Superagent' };
}

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  // Ownership is checked by the API, so a bad or foreign id 404s on the server rather than
  // flashing an empty chat and then erroring in the client.
  if ((await getChatTitle(id)) === null) notFound();

  return <ChatView chatId={id} />;
}
