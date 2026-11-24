import { splitAttachments } from '../../../shared/pastedImages';
import { baseName } from '../lib/fileShare';
import { localImageUrl } from '../lib/localImage';
import { FileLink } from './FileLink';
import '../styles/attach.css';

/** The user's words, with pasted images shown as thumbnails and attached files as chips instead of their paths. */
export function UserText({ text }: { text: string }) {
  const { text: words, images, files } = splitAttachments(text);
  return (
    <>
      {words}
      {images.length > 0 && (
        <div className="user-images">
          {images.map((path) => (
            <img key={path} src={localImageUrl(path) ?? ''} alt="Inklistrad bild" title={path} />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="user-files">
          {files.map((path) => (
            <span className="attach-chip" key={path}>
              <FileLink href={path} path={path}>{baseName(path)}</FileLink>
            </span>
          ))}
        </div>
      )}
    </>
  );
}
