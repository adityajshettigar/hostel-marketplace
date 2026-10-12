"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { ArrowRight } from "lucide-react";
import {
  Button,
  Modal,
  Skeleton,
  Textarea,
  VerifiedResidentBadge,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useAuth, RequireAuth } from "@/lib/auth/auth-context";
import { useConversation, useMessages, usePublicProfile } from "@/lib/api/queries";
import { useSendMessage } from "@/lib/api/mutations";
import { onBlockedMessage } from "@/lib/socket/socket-provider";
import { useConversationSocket, useSocket } from "@/lib/socket/socket-provider";
import { messageFormSchema, type MessageFormInput } from "@/lib/schemas/forms";
import type { Message } from "@/lib/api/types";
import { formatDateTime } from "@/lib/utils";

const BLOCK_REASONS: Record<string, string> = {
  CONTACT_INFO: "Phone numbers are not allowed in chat.",
  UPI_INFO: "UPI/payment ids are not allowed in chat.",
  PAYMENT_REQUEST: "Off-platform payment requests are not allowed in chat.",
};

function TypingIndicator({ name }: { name: string }) {
  const socketAware = useSocket();
  const [visible, setVisible] = React.useState(false);
  // Demo-state typing events are not emitted by the backend today; this
  // indicator lights up from socket "typing" events if/when they arrive.
  React.useEffect(() => {
    const s = socketAware.socket;
    if (!s) return;
    const on = () => {
      setVisible(true);
      const t = setTimeout(() => setVisible(false), 2000);
      return () => clearTimeout(t);
    };
    s.on("typing", on);
    return () => {
      s.off("typing", on);
    };
  }, [socketAware.socket]);
  if (!visible) return null;
  return (
    <p className="px-1 text-[10px] font-bold uppercase tracking-widest text-foreground/70" role="status">
      {name.toUpperCase()} IS TYPING…
    </p>
  );
}

function Bubble({ msg, own }: { msg: Message; blocked?: boolean; own: boolean }) {
  const blocked = msg.safetyResult && msg.safetyResult !== "SAFE";
  const [whyOpen, setWhyOpen] = React.useState(false);
  if (blocked) {
    return (
      <div className="mx-auto w-full max-w-lg border-4 border-red-bauhaus bg-white p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-red-bauhaus">Blocked</p>
        <p className="mt-1 line-through opacity-70">{msg.body}</p>
        <p className="mt-1 text-xs font-bold uppercase tracking-wide text-red-bauhaus">
          {BLOCK_REASONS[msg.safetyResult] ?? "This message was flagged for sharing contact or payment details outside escrow."}
        </p>
        <button type="button" onClick={() => setWhyOpen(true)} className="mt-1 text-xs font-bold uppercase underline decoration-2 underline-offset-4">
          Why?
        </button>
        <Modal open={whyOpen} onClose={() => setWhyOpen(false)} title="Why was this blocked?">
          <p className="font-medium leading-relaxed">
            Chat is scanned in real time for phone numbers, UPI ids and off-platform payment
            requests (SRS 5.7.2). Blocked messages are stored for dispute evidence but are
            never delivered to the other person. Keep the deal inside the marketplace so
            escrow can protect you.
          </p>
        </Modal>
      </div>
      );
  }
  return (
    <div className={`flex ${own ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] border-4 border-black p-3 shadow-md ${
          own ? "bg-blue-bauhaus text-white" : "bg-white text-foreground"
        }`}
      >
        <p className="whitespace-pre-line font-medium leading-snug">{msg.body}</p>
        <p className={`mt-1 text-[10px] font-bold uppercase tracking-widest ${own ? "text-white/70" : "text-foreground/60"}`}>
          {msg.pending ? "Sending…" : formatDateTime(msg.createdAt)}
        </p>
      </div>
    </div>
  );
}

/** Gated: conversations belong to authenticated residents only. */
export default function ChatPage() {
  return (
    <RequireAuth>
      <ChatInner />
    </RequireAuth>
  );
}

function ChatInner() {
  const params = useParams<{ conversationId: string }>();
  const conversationId = params.conversationId;
  const { user, status } = useAuth();
  const { data: convData, isLoading: convLoading } = useConversation(conversationId);
  const { data: msgsData, isLoading: msgsLoading } = useMessages(conversationId);
  const sendMessage = useSendMessage(conversationId);
  const { connected } = useSocket();
  useConversationSocket(conversationId);
  const { toast } = useToast();
  const [scrollPill, setScrollPill] = React.useState(false);
  const threadRef = React.useRef<HTMLDivElement>(null);
  const stickToBottom = React.useRef(true);

  const conversation = convData;
  const counterpartyId = conversation
    ? conversation.buyerId === user?.id
      ? conversation.sellerId
      : conversation.buyerId
    : undefined;
  const { data: profile } = usePublicProfile(counterpartyId);

  React.useEffect(() => {
    return onBlockedMessage((msg) => {
      toast({
        tone: "error",
        title: "MESSAGE BLOCKED",
        body: BLOCK_REASONS[msg.safetyResult] ?? "This message was flagged for sharing contact or payment details outside escrow.",
        persistent: true,
      });
    });
  }, [toast]);

  React.useEffect(() => {
    const el = threadRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [msgsData]);

  const onScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottom.current = atBottom;
    setScrollPill(!atBottom);
  };

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<MessageFormInput>({ resolver: zodResolver(messageFormSchema), mode: "onSubmit" });

  const onSubmit = handleSubmit(async (values) => {
    stickToBottom.current = true;
    reset();
    await sendMessage.mutateAsync(values);
  });

  const body = watch("body");
  const messages = msgsData?.messages ?? [];

  if (status === "unauthenticated") {
    return (
      <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="border-4 border-black bg-surface p-10 text-center shadow-lg">
          <p className="text-2xl font-black uppercase tracking-tight">Log in to open this chat</p>
          <Link href={`/login?next=${encodeURIComponent(`/chat/${conversationId}`)}`}>
            <Button variant="secondary" className="mt-6">Log in</Button>
          </Link>
        </div>
  </main>
    );
  }

  if (convLoading || msgsLoading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <Skeleton className="h-24 w-full" />
        <div className="mt-6 flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className={`h-16 ${i % 2 ? "ml-auto" : ""} w-2/3`} />
          ))}
        </div>
      </main>
    );
  }

  if (!conversation) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="border-4 border-black bg-surface p-10 text-center shadow-lg">
          <p className="text-2xl font-black uppercase tracking-tight">Conversation not found</p>
          <p className="mt-2 font-medium text-foreground/70">You may not be a participant.</p>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="border-b-4 border-black bg-surface">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black uppercase tracking-tight">
              {profile?.fullName ?? "Trader"}
            </p>
            <VerifiedResidentBadge
              block={profile?.hostelBlock ?? null}
              room={profile?.roomNumber ?? null}
              verified={profile?.verificationStatus === "VERIFIED"}
            />
          </div>
          <span className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest ${connected ? "text-foreground/70" : "text-red-bauhaus"}`}>
            <span aria-hidden="true" className={`h-2 w-2 rounded-full border-2 border-black ${connected ? "bg-blue-bauhaus" : "bg-red-bauhaus"}`} />
            {connected ? "Live" : "Reconnecting…"}
            </span>
          {conversation.listingId ? (
            <Link href={`/listings/${conversation.listingId}`}>
              <Button size="sm" variant="outline" rightIcon={<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}>
                View listing
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      <div ref={threadRef} onScroll={onScroll} className="relative flex-1 overflow-y-auto bg-background">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 p-4 sm:px-6 lg:px-8">
          {messages.length === 0 ? (
            <p className="mx-auto mt-10 max-w-sm text-center text-sm font-bold uppercase tracking-wide text-foreground/60">
              No messages yet — say hello and agree a price.
            </p>
          ) : null}
          {messages.map((m) => (
            <Bubble key={m.id} msg={m} own={m.senderId === user?.id} />
          ))}
        </div>
      </div>
      {scrollPill ? (
        <button
          type="button"
          onClick={() => {
            stickToBottom.current = true;
            threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
          }}
          className="press absolute bottom-24 left-1/2 -translate-x-1/2 border-2 border-black bg-yellow-bauhaus px-3 py-1 text-xs font-black uppercase tracking-widest shadow-md"
        >
          New messages ↓
        </button>
      ) : null}

      <form onSubmit={onSubmit} className="border-t-4 border-black bg-white">
        <div className="mx-auto flex max-w-3xl items-end gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex-1">
            <Textarea
              label="Message"
              rows={2}
              placeholder="Type a message…"
              error={errors.body?.message}
              {...register("body")}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void onSubmit();
                }
              }}
            />
          </div>
          <Button type="submit" variant="secondary" loading={sendMessage.isPending} className="mb-1">
            Send
          </Button>
        </div>
        <div className="mx-auto max-w-3xl px-4 pb-2 sm:px-6 lg:px-8">
          <TypingIndicator name={profile?.fullName ?? "They"} />
          <p className="text-[10px] font-medium text-foreground/50">
            Chat is scanned for contact/payment details. Enter sends · Shift+Enter adds a line.
          </p>
        </div>
        {body ? null : null}
      </form>
    </main>
  );
}
