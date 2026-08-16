"use client";

import { FormEvent, useState } from "react";
import { Bot, Menu, Paperclip, Plus, Send, Sparkles } from "lucide-react";

const starter = [
  "Help me plan a product launch",
  "Write a TypeScript API endpoint",
  "Analyze this business idea",
];

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [loading, setLoading] = useState(false);

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((items) => [...items, { role: "user", content: text }]);
    setLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: messages }),
      });
      if (!response.ok) throw new Error("Chat request failed");
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      setMessages((items) => [...items, { role: "assistant", content: "" }]);
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setMessages((items) => items.map((item, index) => index === items.length - 1 ? { ...item, content: answer } : item));
      }
    } catch {
      setMessages((items) => [...items, { role: "assistant", content: "I couldn't reach the AI service. Check your server configuration and OPENAI_API_KEY." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen bg-zinc-950">
      <aside className="hidden w-64 border-r border-zinc-800 bg-zinc-950 p-3 md:flex md:flex-col">
        <button className="mb-4 flex items-center gap-2 rounded-xl border border-zinc-800 px-3 py-3 text-sm hover:bg-zinc-900"><Plus size={17} /> New chat</button>
        <div className="px-2 py-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Recent</div>
        <div className="rounded-lg px-3 py-2 text-sm text-zinc-300">Welcome to your AI workspace</div>
        <div className="mt-auto rounded-xl border border-zinc-800 p-3 text-xs text-zinc-500">AI Chat Platform · Phase 1</div>
      </aside>

      <section className="flex min-h-screen flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-zinc-800 px-4">
          <div className="flex items-center gap-3"><Menu className="md:hidden" size={20} /><Bot size={21} /><span className="font-semibold">AI Workspace</span></div>
          <button className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900">GPT</button>
        </header>

        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <div className="mb-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-4"><Sparkles size={28} /></div>
              <h1 className="text-3xl font-semibold tracking-tight">How can I help you today?</h1>
              <p className="mt-3 max-w-lg text-sm text-zinc-500">Your production AI workspace starts here. Streaming OpenAI chat is connected through a secure server route.</p>
              <div className="mt-8 grid w-full gap-2 sm:grid-cols-3">{starter.map((item) => <button key={item} onClick={() => setInput(item)} className="rounded-xl border border-zinc-800 p-3 text-left text-sm text-zinc-300 hover:bg-zinc-900">{item}</button>)}</div>
            </div>
          ) : (
            <div className="space-y-6 pb-28">{messages.map((message, index) => <div key={index} className={message.role === "user" ? "ml-auto max-w-[85%] rounded-2xl bg-zinc-800 px-4 py-3 text-sm" : "max-w-[90%] px-2 py-3 text-sm leading-7 text-zinc-200"}>{message.content || (loading ? "Thinking…" : "")}</div>)}</div>
          )}

          <form onSubmit={sendMessage} className="sticky bottom-4 mt-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-2 shadow-2xl">
            <div className="flex items-end gap-2"><button type="button" className="rounded-xl p-3 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><Paperclip size={18} /></button><textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }} rows={1} placeholder="Message your AI assistant…" className="max-h-40 min-h-12 flex-1 resize-none bg-transparent px-2 py-3 text-sm outline-none placeholder:text-zinc-600" /><button disabled={!input.trim() || loading} className="rounded-xl bg-white p-3 text-black disabled:opacity-30"><Send size={17} /></button></div>
          </form>
        </div>
      </section>
    </main>
  );
}
