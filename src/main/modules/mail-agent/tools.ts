import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { wrapMailData, type PromptAddress } from './prompts';

const BODY_CAP = 8000;

export interface ToolMail {
  id: number;
  direction: 'in' | 'out';
  from: PromptAddress;
  to: PromptAddress[];
  subject: string;
  at: string;
  bodyText: string;
  attachments: { index: number; name: string; size: number; inline?: boolean }[];
}
export interface ToolThread {
  summary: string;
  mails: ToolMail[];
  /** Drafts proposed earlier (sent, declined, superseded). */
  drafts: { version: number; status: string; body: string }[];
  events: { at: string; kind: string }[];
}
export interface ToolSearchHit { mailId: number; from: PromptAddress; subject: string; at: string; snippet: string }

/** Plain async callbacks supplied by mail-root; this module never touches the store or the source. */
export interface MailToolDeps {
  getThread(threadId: string): Promise<ToolThread>;
  readMail(threadId: string, mailId: number): Promise<ToolMail | null>;
  search(threadId: string, query: string, limit: number): Promise<ToolSearchHit[]>;
  /** Saves into the thread folder; returns the full path. */
  saveAttachment(threadId: string, mailId: number, index: number): Promise<string>;
  proposeReply(threadId: string, reply: { body: string; replyAll: boolean; attachments: string[] }): Promise<void>;
  note(threadId: string, summary: string): Promise<void>;
}

const cut = (s: string) => (s.length > BODY_CAP ? s.slice(0, BODY_CAP) + '\n[... avkortat]' : s);
const addr = (a: PromptAddress) => (a.name ? `${a.name} <${a.address}>` : a.address);

function mailText(m: ToolMail): string {
  const head = `[mejl ${m.id}, ${m.direction === 'in' ? 'inkommande' : 'utgående'}] ${m.at}\nFrån: ${addr(m.from)}\nTill: ${m.to.map(addr).join(', ')}\nÄmne: ${m.subject}`;
  const att = m.attachments.filter((a) => !a.inline).map((a) => `${a.index}: ${a.name}`).join('; ');
  return `${head}${att ? `\nBilagor: ${att}` : ''}\n${wrapMailData(cut(m.bodyText))}`;
}

export type ToolHandlers = {
  get_thread(): Promise<string>;
  read_mail(a: { mailId: number }): Promise<string>;
  search_mail(a: { query: string; limit?: number }): Promise<string>;
  save_attachment(a: { mailId: number; index: number }): Promise<string>;
  propose_reply(a: { body: string; replyAll?: boolean; attachments?: string[] }): Promise<string>;
  note(a: { summary: string }): Promise<string>;
};

/** The tool logic, bound to one thread. Pure over deps, so it can be tested without the MCP layer. */
export function handlers(threadId: string, deps: MailToolDeps): ToolHandlers {
  return {
    async get_thread() {
      const t = await deps.getThread(threadId);
      const drafts = t.drafts.map((d) => `Utkast ${d.version} (${d.status}):\n${d.body}`).join('\n\n');
      return [
        `Sammanfattning hittills: ${t.summary || '(ingen)'}`,
        ...t.mails.map(mailText),
        drafts ? `Tidigare utkast:\n${drafts}` : '',
        t.events.length ? `Händelser: ${t.events.map((e) => `${e.at} ${e.kind}`).join('; ')}` : '',
      ].filter(Boolean).join('\n\n');
    },
    async read_mail({ mailId }) {
      const m = await deps.readMail(threadId, mailId);
      return m ? mailText(m) : 'Mejlet finns inte.';
    },
    async search_mail({ query, limit }) {
      const hits = await deps.search(threadId, query, Math.min(Math.max(limit ?? 10, 1), 20));
      if (!hits.length) return 'Inga träffar.';
      return hits.map((h) => `[mejl ${h.mailId}] ${h.at} ${addr(h.from)}: ${h.subject}\n${wrapMailData(h.snippet)}`).join('\n\n');
    },
    async save_attachment({ mailId, index }) {
      return `Sparad: ${await deps.saveAttachment(threadId, mailId, index)}`;
    },
    async propose_reply({ body, replyAll, attachments }) {
      await deps.proposeReply(threadId, { body, replyAll: replyAll ?? false, attachments: attachments ?? [] });
      return 'Utkastet visas för användaren. Det skickas bara om användaren godkänner det.';
    },
    async note({ summary }) {
      await deps.note(threadId, summary);
      return 'Sammanfattningen är sparad.';
    },
  };
}

/** The in-process MCP server "mail": the mail agent's only tools. There is deliberately no send tool. */
export function createMailTools(threadId: string, deps: MailToolDeps) {
  const h = handlers(threadId, deps);
  const run = (f: () => Promise<string>) => f().then(
    (text) => ({ content: [{ type: 'text' as const, text }] }),
    (e: unknown) => ({ content: [{ type: 'text' as const, text: `Fel: ${e instanceof Error ? e.message : 'misslyckades'}` }], isError: true }),
  );
  const ro = { readOnlyHint: true };
  const local = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
  return createSdkMcpServer({
    name: 'mail',
    tools: [
      tool('get_thread', 'Hela mejltråden (mejl som data), tidigare utkast, sammanfattning och händelser.', {}, () => run(h.get_thread), { annotations: ro }),
      tool('read_mail', 'Läs ett mejl som appen känner till, även från andra trådar.', { mailId: z.number().int().positive() }, (a) => run(() => h.read_mail(a)), { annotations: ro }),
      tool('search_mail', 'Sök i mejlen (rubrik, text, avsändare).', { query: z.string().min(1).max(200), limit: z.number().int().min(1).max(20).optional() }, (a) => run(() => h.search_mail(a)), { annotations: ro }),
      tool('save_attachment', 'Spara en bilaga i trådmappen och få sökvägen, så du kan läsa den.', { mailId: z.number().int().positive(), index: z.number().int().min(1) }, (a) => run(() => h.save_attachment(a)), { annotations: local }),
      tool('propose_reply', 'Lämna ett svarsutkast till användaren. Inget skickas förrän användaren godkänner. Bilagor anges med full sökväg.', { body: z.string().min(1).max(50000), replyAll: z.boolean().optional(), attachments: z.array(z.string()).max(10).optional() }, (a) => run(() => h.propose_reply(a)), { annotations: local }),
      tool('note', 'Spara en sammanfattning (2-4 meningar) av trådens läge och vad som gjorts.', { summary: z.string().min(1).max(2000) }, (a) => run(() => h.note(a)), { annotations: local }),
    ],
  });
}
