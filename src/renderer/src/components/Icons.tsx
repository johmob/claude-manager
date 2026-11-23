import type { ReactNode } from 'react';

/** 16 px line icons in the current text colour. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Speech bubble with a plus: a new conversation. */
export const ChatIcon = () => (
  <Icon>
    <path d="M2.5 3.5h11v7.5h-6l-3 2.5v-2.5h-2z" />
    <path d="M8 5.5v3.5M6.25 7.25h3.5" />
  </Icon>
);

/** Folder with a plus: a new project folder. */
export const NewProjectIcon = () => (
  <Icon>
    <path d="M1.75 4.25v8h12.5v-6.5h-6.5l-1.5-1.5z" />
    <path d="M8 7.25v3.5M6.25 9h3.5" />
  </Icon>
);

/** Folder with a return arrow: back to existing work. */
export const ExistingProjectIcon = () => (
  <Icon>
    <path d="M1.75 4.25v8h12.5v-6.5h-6.5l-1.5-1.5z" />
    <path d="M10 10.25H6.5M7.75 8.75l-1.5 1.5 1.5 1.5" />
  </Icon>
);

/** Ruled page: the shared ground rules. */
export const RulesIcon = () => (
  <Icon>
    <path d="M3.5 1.75h6.5l2.5 2.5v10h-9z" />
    <path d="M5.75 7h4.5M5.75 9.25h4.5M5.75 11.5h3" />
  </Icon>
);

/** Two people: a session's agents. */
export const AgentsIcon = () => (
  <Icon>
    <circle cx="6" cy="5.25" r="2.25" />
    <path d="M1.75 13.25c.4-2.4 2.1-3.75 4.25-3.75s3.85 1.35 4.25 3.75" />
    <path d="M10.25 3.25a2.25 2.25 0 0 1 0 4.25M11.75 9.75c1.25.5 2.15 1.65 2.5 3.5" />
  </Icon>
);

/** Paper plane: send. */
export const SendIcon = () => (
  <Icon>
    <path d="M2.5 7.75 13.5 2.5l-3.75 11-2.5-4.75z" />
    <path d="m7.25 8.75 6.25-6.25" />
  </Icon>
);

/** Plus: start something new. */
export const PlusIcon = () => (
  <Icon>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

/** Bin: remove. */
export const TrashIcon = () => (
  <Icon>
    <path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4 4.25l.75 9h6.5l.75-9" />
    <path d="M6.75 6.75v4.25M9.25 6.75v4.25" />
  </Icon>
);

/** Moon struck through: no sleep. */
export const NoSleepIcon = () => (
  <Icon>
    <path d="M12.75 9.75A5.25 5.25 0 0 1 6.25 3.25a5.25 5.25 0 1 0 6.5 6.5z" />
    <path d="M2.5 2.5l11 11" />
  </Icon>
);
