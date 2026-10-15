import type { Metadata } from "next";
import { NewChatLanding } from "./new-chat-landing";

export const metadata: Metadata = { title: "Flight Deck" };

/** Empty state: start a chat, or pick one from the history rail. */
export default function AppHome() {
  return <NewChatLanding />;
}
