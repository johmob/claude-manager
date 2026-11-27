import type { MailHeader as FullMailHeader, MailRule as StoredMailRule } from '../../../shared/contracts';

export type { MailAccount, MailAddress, MailAttachmentInfo, MailCategory, MailRuleKind } from '../../../shared/contracts';
/** The fields triage reads; the full MailHeader from contracts is assignable to it. */
export type MailHeader = Pick<FullMailHeader, 'messageClass' | 'from' | 'to' | 'cc' | 'subject' | 'attachments' | 'headers'>;
/** A rule as triage reads it; the id is only known for stored rules. */
export type MailRule = Omit<StoredMailRule, 'id'> & { id?: number };
