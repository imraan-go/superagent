"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

/** Create a chat and navigate to it — shared by the palette and ⌘J. */
export function useNewChat() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createChat,
    onSuccess: async ({ chat }) => {
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      router.push(`/chat/${chat.id}`);
    },
  });
}
