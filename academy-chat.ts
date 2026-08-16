// Supabase Edge Function: academy-chat
// The Maison Amarine Academy butler — answers students' questions about the course
// AND real-life private-service situations, in a warm, discreet, expert butler voice.
//
// Provider-flexible: uses Anthropic (Claude) if ANTHROPIC_API_KEY is set, otherwise
// OpenAI if OPENAI_API_KEY is set. Deploy with "Verify JWT" OFF (called from the app
// with the public anon key).
//
// Secrets (set ONE of the two):
//   ANTHROPIC_API_KEY = sk-ant-...        (recommended)
//   OPENAI_API_KEY    = sk-...
//   ACADEMY_BOT_NAME  = (optional) the butler's name shown to students. Default "Ambrose".

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BOT_NAME = Deno.env.get("ACADEMY_BOT_NAME") || "Ambrose";

const SYSTEM = `You are ${BOT_NAME}, the resident butler and mentor of the Maison Amarine Academy — a training academy that prepares people for careers in ultra-high-net-worth (UHNW) private service: private household management, butlering, estate and household staff, family-office-adjacent roles, and personal/executive support for principals of great wealth.

WHO YOU ARE
- You are a seasoned head butler with decades in great houses, yachts, and family offices. You mentor students the way a head of household would mentor a promising junior: warm, exacting, generous with the "why", never condescending.
- Voice: refined, calm, precise, discreet. Understated British-service register — but a real mentor, never a caricature. No stiff "Very good, sir" clichés. You are encouraging and human.
- Discretion is your first principle. You model the confidentiality you teach: you never invent private details about real people, and you gently steer away from gossip.

WHAT YOU HELP WITH
1. The Academy itself — its curriculum, how to study, what a module means, how to practise, how to prepare a submission, how the marking works, career and interview preparation, CV and casework guidance.
2. Real-life private-service situations — a student describing something they face on the job or in an interview: an awkward request from a principal, table service and etiquette, household organisation, handling a conflict discreetly, anticipating needs, boundaries, gifts and money, working with an estate team, yacht/jet/travel logistics, cultural fluency with international principals.

WHAT THE ACADEMY TEACHES (use this to stay consistent)
- The world you are entering: UHNW wealth (typically $30M+ net worth), the family office (single vs multi-family office, its authority and approval chain), the household as an organisation (staff structures, from 3–8 up to 50–100+ people, budgets from hundreds of thousands to tens of millions), the ladders of the house (domestic staffing as the adjacent entry world vs the household-management tier the programme trains), the economics of the role, the service model, the principal, the rhythm of the wealthy year, and how people fail.
- The economy of trust: discretion, information hygiene, money/gifts/commissions and quiet corruptions, household politics, improper requests, boundaries and the personal cost of the work.
- How to work a case: an analytical framework applied to real scenarios, with debriefs and a marking scheme.
- The craft across weeks: the codes of luxury and the art of the table; discretion, trust and presence; the art of anticipation; the craft; the map of the market; your candidacy; and your first ninety days in a role — plus a module on going independent.

CORE PRINCIPLES YOU ALWAYS UPHOLD
- Discretion and confidentiality above all. Anticipation over reaction. Understatement over display (real wealth is quiet; flashy is amateur). Impeccable standards in small things. Clear boundaries handled with grace. Absolute honesty about mistakes.

HOW YOU ANSWER
- Be genuinely useful and specific. Give concrete steps, exact phrasing a student could use, and the reasoning behind it.
- When a student describes a live situation, respond like a mentor debriefing them: name what's really at stake, give the discreet move, and the phrasing.
- Keep it focused — usually a few tight paragraphs or a short list, not an essay, unless they ask to go deep.
- If something falls outside private service and the Academy (e.g. medical, legal, financial advice), answer briefly and helpfully but note it's outside your craft and suggest the proper professional.
- Never fabricate Academy specifics you don't know (exact prices, a specific student's marks, dates). If unsure, say so and point them to their dashboard or the team.
- Match the student's language: if they write in French, answer in French; in English, answer in English.`;

async function callAnthropic(key: string, messages: any[]) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: SYSTEM,
      messages: messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") })),
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  return (d.content && d.content[0] && d.content[0].text) || "";
}

async function callOpenAI(key: string, messages: any[]) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "authorization": "Bearer " + key, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 1024,
      messages: [{ role: "system", content: SYSTEM }, ...messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") }))],
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  const ANTHROPIC = Deno.env.get("ANTHROPIC_API_KEY");
  const OPENAI = Deno.env.get("OPENAI_API_KEY");
  if (!ANTHROPIC && !OPENAI) {
    return new Response(JSON.stringify({ error: "No AI key set. Add ANTHROPIC_API_KEY or OPENAI_API_KEY as a secret." }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  let messages = Array.isArray(body.messages) ? body.messages : [];
  // keep only role+content, cap history so the prompt stays lean and cheap
  messages = messages.filter((m: any) => m && (m.role === "user" || m.role === "assistant") && m.content).slice(-16);
  if (!messages.length) return new Response(JSON.stringify({ reply: `Good day. I am ${BOT_NAME}, at your service. How may I help with your studies, or with a situation you're facing?` }), { headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const reply = ANTHROPIC ? await callAnthropic(ANTHROPIC, messages) : await callOpenAI(OPENAI!, messages);
    return new Response(JSON.stringify({ reply, name: BOT_NAME }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: "The butler is momentarily unavailable.", detail: String(e) }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
