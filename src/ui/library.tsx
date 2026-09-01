import { fileName, type Photo } from "../catalog/types";
import { photoThumbSrc } from "../catalog/media";

export function LibraryGrid(props: {
  photos: Photo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="lib-grid">
      {props.photos.map((p) => {
        const src = photoThumbSrc(p);
        return (
          <button
            key={p.id}
            type="button"
            className={`cell${p.id === props.selectedId ? " sel" : ""}`}
            onClick={() => props.onSelect(p.id)}
            onDoubleClick={() => props.onOpen(p.id)}
          >
            {src && !p.missing ? (
              <img src={src} alt={fileName(p.path)} />
            ) : (
              <div className="cell-miss">
                {p.kind === "raw" ? "RAW" : p.missing ? "Missing" : "—"}
              </div>
            )}
            <span className="cell-cap">
              {fileName(p.path)}
              {p.rating > 0 ? ` · ${"★".repeat(p.rating)}` : ""}
              {p.flag === "pick" ? " · P" : p.flag === "reject" ? " · X" : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Filmstrip(props: {
  photos: Photo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="strip">
      {props.photos.map((p) => {
        const src = photoThumbSrc(p);
        return (
          <button
            key={p.id}
            type="button"
            className={`strip-item${p.id === props.selectedId ? " sel" : ""}`}
            onClick={() => props.onSelect(p.id)}
            title={fileName(p.path)}
          >
            {src && !p.missing ? (
              <img src={src} alt="" />
            ) : (
              <span className="cell-miss sm">{p.kind === "raw" ? "RAW" : "?"}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function FolderList(props: {
  folders: string[];
  active: string | null;
  onPick: (folder: string | null) => void;
}) {
  return (
    <ul className="folders">
      <li>
        <button type="button" className={props.active === null ? "on" : ""} onClick={() => props.onPick(null)}>
          All photographs
        </button>
      </li>
      {props.folders.map((f) => (
        <li key={f}>
          <button type="button" className={props.active === f ? "on" : ""} onClick={() => props.onPick(f)}>
            {f.split(/[/\\]/).pop() || f}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function MetaList({ photo }: { photo: Photo }) {
  const exposure = [photo.exif.ExposureTime, photo.exif.FNumber, photo.exif.ISO && `ISO ${photo.exif.ISO}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <dl className="meta">
      <dt>File</dt>
      <dd>{fileName(photo.path)}</dd>
      <dt>Size</dt>
      <dd>{photo.width && photo.height ? `${photo.width} × ${photo.height}` : "—"}</dd>
      {photo.exif.Model ? (
        <>
          <dt>Camera</dt>
          <dd>{photo.exif.Model}</dd>
        </>
      ) : null}
      {photo.exif.LensModel ? (
        <>
          <dt>Lens</dt>
          <dd>
            {photo.exif.LensModel}
            {photo.exif.FocalLength ? ` @ ${photo.exif.FocalLength}` : ""}
          </dd>
        </>
      ) : null}
      {exposure ? (
        <>
          <dt>Exposure</dt>
          <dd>{exposure}</dd>
        </>
      ) : null}
      <dt>Flag</dt>
      <dd>{photo.flag}</dd>
      <dt>Rating</dt>
      <dd>{photo.rating ? `${photo.rating} ★` : "unrated"}</dd>
    </dl>
  );
}
