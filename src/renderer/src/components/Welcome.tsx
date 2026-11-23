import { Modal } from './Modal';

/**
 * Shown on first start, until the user has chosen where their projects live. Also says what the app
 * needs to talk to Claude, for colleagues installing it on a new computer.
 */
export function Welcome({ onLater }: { onLater: () => void }) {
  return (
    <Modal title="Välkommen till Claude Manager" onClose={onLater}>
      <div className="welcome">
        <p>
          <strong>Välj mappen där dina projekt ligger</strong>, eller ska ligga. Nya projekt skapas där, och appen letar där när du öppnar ett
          befintligt projekt. Du kan byta senare under Nytt projekt eller Befintligt projekt.
        </p>
        <p className="muted">
          Appen använder din Claude-inloggning från Claude Code. Har du inte loggat in på den här datorn: installera Claude Code, kör
          <code> claude </code> i en terminal en gång och logga in.
        </p>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onLater}>Senare</button>
          <button type="button" className="btn primary" onClick={() => void window.cm.invoke('settings:choose-projects-root', undefined)}>Välj mapp…</button>
        </div>
      </div>
    </Modal>
  );
}
