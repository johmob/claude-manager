// icon-picker: has a cheap model choose an icon for a card from the app's pool (SESSION_ICONS), to suit
// the project as its work schema describes it. Builds the request and reads the reply; the composition
// root makes the call and saves the choice.
import { SESSION_ICONS, type SessionIconName, type StructuredRequest } from '../../../shared/contracts';

const MAX_TITLES = 40;

const SCHEMA = {
  type: 'object',
  properties: { icon: { type: 'string', enum: [...SESSION_ICONS] } },
  required: ['icon'],
  additionalProperties: false,
};

/** `titles`: the schema's title, tracks and items, most telling first. */
export function iconRequest(name: string, titles: string[], cwd: string): StructuredRequest {
  const prompt = [
    'Välj en ikon som passar projektet nedan, så att användaren känner igen det bland många projekt.',
    'Välj det föremål eller område projektet handlar om (t.ex. en gripdon-design: grab; firmware: cpu; en webbsida: globe), inte hur arbetet går till.',
    `Ikoner (lucide-namn): ${SESSION_ICONS.join(', ')}`,
    '',
    `Projekt: ${name}`,
    ...titles.slice(0, MAX_TITLES).map((t) => `- ${t}`),
    '',
    'Svara med JSON.',
  ].join('\n');
  return { prompt, schema: SCHEMA, model: 'haiku', cwd, tools: [], maxTurns: 3 };
}

export function readIcon(reply: unknown): SessionIconName | null {
  const icon = typeof reply === 'object' && reply !== null ? (reply as { icon?: unknown }).icon : undefined;
  return (SESSION_ICONS as readonly unknown[]).includes(icon) ? (icon as SessionIconName) : null;
}
