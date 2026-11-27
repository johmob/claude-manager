// Local copies of the mail contract types (the shared block is added to src/shared/contracts.ts by another task).
// Structurally identical; once contracts.ts has them, replace this file's contents with re-exports.
export type MailCategory = 'junk' | 'bulk' | 'info' | 'reply' | 'action' | 'meeting' | 'private';
export type MailRuleKind = 'ignore_sender' | 'important_sender' | 'never_ai_sender' | 'never_ai_subject';
export interface MailAddress { name: string; address: string }
export interface MailAttachmentInfo { index: number; name: string; size: number; inline: boolean }
/** The fields triage reads; the full MailHeader from contracts is assignable to it. */
export interface MailHeader {
  messageClass: string;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  attachments: MailAttachmentInfo[];
  headers: Record<string, string>;
}
export interface MailAccount { address: string; displayName: string }
export interface MailRule { id?: number; kind: MailRuleKind; pattern: string }
