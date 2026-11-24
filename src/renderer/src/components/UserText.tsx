import { splitImageRefs } from '../../../shared/pastedImages';
import { imageSrc, localImageUrl } from '../lib/localImage';

/** The user's words, with pasted images shown as thumbnails instead of their file paths. */
export function UserText({ text }: { text: string }) {
  const { text: words, images } = splitImageRefs(text);
  return (
    <>
      {words}
      {images.length > 0 && (
        <div className="user-images">
          {images.map((path) => (
            <img key={path} src={imageSrc(localImageUrl(path) ?? '')} alt="Inklistrad bild" title={path} />
          ))}
        </div>
      )}
    </>
  );
}
