import type { CSSProperties } from "react";
import type { Flag } from "../recipe/types";
import {
  DEFAULT_LIBRARY_FILTERS,
  type LibraryFilters,
  type LibrarySort,
  uniqueCameras,
  uniqueLenses,
} from "../catalog/filter";
import { fileName, photoLabel, type Collection, type ColorLabel, type Photo } from "../catalog/types";
import { photoDisplaySrc, photoThumbSrc } from "../catalog/media";
import { stackCount } from "../catalog/stacks";

export type LibraryView = "grid" | "compare" | "loupe" | "survey";
export type LoupeZoom = "fit" | "100" | "200";

const LOUPE_ZOOMS: LoupeZoom[] = ["fit", "100", "200"];

const LOUPE_LABELS: Record<LoupeZoom, string> = { fit: "Fit", "100": "1:1", "200": "2:1" };

export const COLOR_LABELS: ColorLabel[] = ["red", "yellow", "green", "blue", "purple"];

export function nextLoupeZoom(current: LoupeZoom): LoupeZoom {
  const i = LOUPE_ZOOMS.indexOf(current);
  return LOUPE_ZOOMS[(i + 1) % LOUPE_ZOOMS.length];
}

export function colorLabelStyle(label: ColorLabel | null): CSSProperties | undefined {
  if (!label) return undefined;
  const colors: Record<ColorLabel, string> = {
    red: "#e74c3c",
    yellow: "#f1c40f",
    green: "#2ecc71",
    blue: "#3498db",
    purple: "#9b59b6",
  };
  return { background: colors[label] };
}

function CellBadge({ photo }: { photo: Photo }) {
  return (
    <>
      {photo.colorLabel ? <span className="color-badge" style={colorLabelStyle(photo.colorLabel)} /> : null}
      {photo.quickCollection ? <span className="quick-badge" title="Quick Collection">Q</span> : null}
    </>
  );
}

export function LibraryGrid(props: {
  photos: Photo[];
  allPhotos: Photo[];
  selectedId: string | null;
  expandedStacks: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onToggleStack: (stackId: string) => void;
}) {
  return (
    <div className="lib-grid">
      {props.photos.map((p) => {
        const src = photoThumbSrc(p);
        const count = p.stackId ? stackCount(props.allPhotos, p.stackId) : 0;
        const collapsed = count > 1 && !props.expandedStacks.has(p.stackId!);
        return (
          <button
            key={p.id}
            type="button"
            className={`cell${p.id === props.selectedId ? " sel" : ""}${collapsed ? " stacked" : ""}`}
            onClick={() => props.onSelect(p.id)}
            onDoubleClick={() => props.onOpen(p.id)}
          >
            <div className="cell-badges">
              <CellBadge photo={p} />
              {collapsed ? (
                <span
                  role="button"
                  tabIndex={0}
                  className="stack-badge"
                  title={`${count} photos in stack`}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onToggleStack(p.stackId!);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      props.onToggleStack(p.stackId!);
                    }
                  }}
                >
                  {count}
                </span>
              ) : null}
            </div>
            {src && !p.missing ? (
              <img src={src} alt={fileName(p.path)} />
            ) : (
              <div className="cell-miss">
                {p.kind === "raw" ? "RAW" : p.missing ? "Missing" : "—"}
              </div>
            )}
            <span className="cell-cap">
              {photoLabel(p)}
              {p.rating > 0 ? ` · ${"★".repeat(p.rating)}` : ""}
              {p.flag === "pick" ? " · P" : p.flag === "reject" ? " · X" : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function CompareView(props: {
  photos: Photo[];
  selectedId: string | null;
  activeSide: "left" | "right";
  onSelectSide: (side: "left" | "right") => void;
  onSelectPhoto: (id: string) => void;
}) {
  const index = Math.max(0, props.photos.findIndex((p) => p.id === props.selectedId));
  const left = props.photos[index] ?? null;
  const right = props.photos[index + 1] ?? props.photos[0] ?? null;

  function pane(photo: Photo | null, side: "left" | "right") {
    if (!photo) return <div className="compare-pane empty">No photo</div>;
    const src = photoThumbSrc(photo);
    return (
      <button
        type="button"
        className={`compare-pane${props.activeSide === side ? " active" : ""}`}
        onClick={() => {
          props.onSelectSide(side);
          props.onSelectPhoto(photo.id);
        }}
      >
        {src && !photo.missing ? <img src={src} alt="" /> : <div className="cell-miss">—</div>}
        <span className="compare-cap">
          {photoLabel(photo)}
          {photo.rating > 0 ? ` · ${"★".repeat(photo.rating)}` : ""}
          {photo.flag === "pick" ? " · P" : photo.flag === "reject" ? " · X" : ""}
        </span>
      </button>
    );
  }

  return (
    <div className="compare-view">
      {pane(left, "left")}
      {pane(right, "right")}
    </div>
  );
}

function photoCaption(photo: Photo) {
  return (
    <>
      {photoLabel(photo)}
      {photo.rating > 0 ? ` · ${"★".repeat(photo.rating)}` : ""}
      {photo.flag === "pick" ? " · P" : photo.flag === "reject" ? " · X" : ""}
    </>
  );
}

export function LoupeView(props: {
  photo: Photo | null;
  zoom: LoupeZoom;
  onZoom: (zoom: LoupeZoom) => void;
  onOpen: () => void;
}) {
  const { photo, zoom } = props;
  if (!photo) return <div className="library-view loupe-view empty">No photo selected</div>;
  const src = photoDisplaySrc(photo);
  return (
    <div className="library-view loupe-view">
      <div className="loupe-toolbar">
        <span className="loupe-cap">{photoCaption(photo)}</span>
        <div className="loupe-zoom-btns">
          {LOUPE_ZOOMS.map((z) => (
            <button
              key={z}
              type="button"
              className={zoom === z ? "on" : ""}
              onClick={() => props.onZoom(z)}
            >
              {LOUPE_LABELS[z]}
            </button>
          ))}
        </div>
        <button type="button" className="btn-ghost" onClick={props.onOpen}>
          Develop
        </button>
      </div>
      <button type="button" className={`loupe-stage zoom-${zoom}`} onDoubleClick={props.onOpen}>
        {src && !photo.missing ? (
          <img src={src} alt={fileName(photo.path)} />
        ) : (
          <div className="cell-miss">{photo.kind === "raw" ? "RAW" : photo.missing ? "Missing" : "—"}</div>
        )}
      </button>
    </div>
  );
}

export function SurveyView(props: {
  photos: Photo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const index = Math.max(0, props.photos.findIndex((p) => p.id === props.selectedId));
  const start = Math.max(0, index - 5);
  const slice = props.photos.slice(start, start + 12);
  if (!slice.length) return <div className="library-view survey-view empty">No photos</div>;

  return (
    <div className="library-view survey-view">
      <p className="survey-hint">Click to select · P pick · X reject · arrows navigate</p>
      <div className="survey-grid">
        {slice.map((p) => {
          const src = photoDisplaySrc(p);
          return (
            <button
              key={p.id}
              type="button"
              className={`survey-cell${p.id === props.selectedId ? " sel" : ""}`}
              onClick={() => props.onSelect(p.id)}
              onDoubleClick={() => props.onOpen(p.id)}
            >
              <div className="cell-badges">
                <CellBadge photo={p} />
              </div>
              {src && !p.missing ? (
                <img src={src} alt={fileName(p.path)} />
              ) : (
                <div className="cell-miss">{p.kind === "raw" ? "RAW" : "?"}</div>
              )}
              <span className="cell-cap">{photoCaption(p)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function LibraryToolbar(props: {
  photos: Photo[];
  filters: LibraryFilters;
  sort: LibrarySort;
  libraryView: LibraryView;
  autoAdvance: boolean;
  onFilters: (next: LibraryFilters) => void;
  onSort: (sort: LibrarySort) => void;
  onView: (view: LibraryView) => void;
  onAutoAdvance: (on: boolean) => void;
}) {
  const cameras = uniqueCameras(props.photos);
  const lenses = uniqueLenses(props.photos);
  return (
    <div className="library-toolbar">
      <input
        className="lib-search"
        placeholder="Search keywords, metadata…"
        value={props.filters.text}
        onChange={(e) => props.onFilters({ ...props.filters, text: e.target.value })}
      />
      <label>
        Min ★
        <select
          value={props.filters.minRating}
          onChange={(e) => props.onFilters({ ...props.filters, minRating: Number(e.target.value) })}
        >
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? "Any" : n}
            </option>
          ))}
        </select>
      </label>
      <label>
        Flag
        <select
          value={props.filters.flag}
          onChange={(e) => props.onFilters({ ...props.filters, flag: e.target.value as Flag | "any" })}
        >
          <option value="any">Any</option>
          <option value="pick">Pick</option>
          <option value="reject">Reject</option>
          <option value="unflagged">Unflagged</option>
        </select>
      </label>
      <label>
        Camera
        <select
          value={props.filters.camera}
          onChange={(e) => props.onFilters({ ...props.filters, camera: e.target.value })}
        >
          <option value="">Any</option>
          {cameras.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label>
        Lens
        <select
          value={props.filters.lens}
          onChange={(e) => props.onFilters({ ...props.filters, lens: e.target.value })}
        >
          <option value="">Any</option>
          {lenses.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        Label
        <select
          value={props.filters.colorLabel}
          onChange={(e) =>
            props.onFilters({
              ...props.filters,
              colorLabel: e.target.value as LibraryFilters["colorLabel"],
            })
          }
        >
          <option value="any">Any</option>
          {COLOR_LABELS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label>
        Sort
        <select value={props.sort} onChange={(e) => props.onSort(e.target.value as LibrarySort)}>
          <option value="filename">File name</option>
          <option value="rating">Rating</option>
          <option value="capture">Capture date</option>
          <option value="mtime">Import date</option>
        </select>
      </label>
      <button
        type="button"
        className={props.libraryView === "grid" ? "on" : ""}
        onClick={() => props.onView("grid")}
      >
        Grid
      </button>
      <button
        type="button"
        className={props.libraryView === "compare" ? "on" : ""}
        onClick={() => props.onView("compare")}
      >
        Compare
      </button>
      <button
        type="button"
        className={props.libraryView === "loupe" ? "on" : ""}
        onClick={() => props.onView("loupe")}
      >
        Loupe
      </button>
      <button
        type="button"
        className={props.libraryView === "survey" ? "on" : ""}
        onClick={() => props.onView("survey")}
      >
        Survey
      </button>
      <label className="mask-check">
        <input
          type="checkbox"
          checked={props.autoAdvance}
          onChange={(e) => props.onAutoAdvance(e.target.checked)}
        />
        Auto-advance
      </label>
      <button
        type="button"
        className="btn-ghost"
        onClick={() => props.onFilters(DEFAULT_LIBRARY_FILTERS)}
      >
        Clear filters
      </button>
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

export function CollectionsList(props: {
  collections: Collection[];
  active: string | null;
  quickCount: number;
  quickActive: boolean;
  onPick: (id: string | null) => void;
  onQuick: () => void;
  onCreate: () => void;
  onCreateSmart: () => void;
  onAddPhoto: () => void;
  onRemovePhoto: () => void;
  canManagePhoto: boolean;
}) {
  const activeCollection = props.collections.find((c) => c.id === props.active);
  const isManual = activeCollection?.kind !== "smart";
  return (
    <>
      <ul className="folders">
        <li>
          <button
            type="button"
            className={props.active === null && !props.quickActive ? "on" : ""}
            onClick={() => props.onPick(null)}
          >
            All collections
          </button>
        </li>
        <li>
          <button type="button" className={props.quickActive ? "on" : ""} onClick={props.onQuick}>
            Quick Collection ({props.quickCount})
          </button>
        </li>
        {props.collections.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={props.active === c.id ? "on" : ""}
              onClick={() => props.onPick(c.id)}
            >
              {c.kind === "smart" ? "⚡ " : ""}
              {c.name}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn-ghost" onClick={props.onCreate}>
        New collection
      </button>
      <button type="button" className="btn-ghost" onClick={props.onCreateSmart}>
        New smart collection
      </button>
      {props.active && props.canManagePhoto && isManual ? (
        <div className="collection-actions">
          <button type="button" className="btn-ghost" onClick={props.onAddPhoto}>
            Add photo
          </button>
          <button type="button" className="btn-ghost" onClick={props.onRemovePhoto}>
            Remove photo
          </button>
        </div>
      ) : null}
    </>
  );
}

export function SnapshotsList(props: {
  snapshots: Array<{ id: string; name: string }>;
  onApply: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <>
      <ul className="folders">
        {props.snapshots.map((s) => (
          <li key={s.id} className="snapshot-row">
            <button type="button" onClick={() => props.onApply(s.id)}>
              {s.name}
            </button>
            <button type="button" className="btn-icon" title="Delete snapshot" onClick={() => props.onDelete(s.id)}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn-ghost" onClick={props.onCreate}>
        Save snapshot
      </button>
    </>
  );
}

export function MetaList({
  photo,
  onPatch,
}: {
  photo: Photo;
  onPatch: (
    patch: Partial<
      Pick<
        Photo,
        "title" | "caption" | "copyright" | "creator" | "keywords" | "colorLabel" | "latitude" | "longitude"
      >
    >,
  ) => void;
}) {
  const exposure = [photo.exif.ExposureTime, photo.exif.FNumber, photo.exif.ISO && `ISO ${photo.exif.ISO}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <dl className="meta">
      <dt>File</dt>
      <dd>{photoLabel(photo)}</dd>
      <dt>Title</dt>
      <dd>
        <input
          className="meta-input"
          value={photo.title}
          onChange={(e) => onPatch({ title: e.target.value })}
          placeholder="Title"
        />
      </dd>
      <dt>Caption</dt>
      <dd>
        <textarea
          className="meta-input"
          value={photo.caption}
          rows={2}
          onChange={(e) => onPatch({ caption: e.target.value })}
          placeholder="Caption"
        />
      </dd>
      <dt>Keywords</dt>
      <dd>
        <input
          className="meta-input"
          value={photo.keywords.join(", ")}
          onChange={(e) =>
            onPatch({
              keywords: e.target.value
                .split(",")
                .map((k) => k.trim())
                .filter(Boolean),
            })
          }
          placeholder="landscape, portrait"
        />
      </dd>
      <dt>Color label</dt>
      <dd className="label-row">
        {COLOR_LABELS.map((label) => (
          <button
            key={label}
            type="button"
            className={`label-btn${photo.colorLabel === label ? " on" : ""}`}
            style={colorLabelStyle(label)}
            title={label}
            onClick={() => onPatch({ colorLabel: photo.colorLabel === label ? null : label })}
          />
        ))}
      </dd>
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
      <dt>Latitude</dt>
      <dd>
        <input
          className="meta-input"
          type="number"
          step="any"
          value={photo.latitude ?? ""}
          placeholder="e.g. 37.7749"
          onChange={(e) => {
            const raw = e.target.value.trim();
            onPatch({ latitude: raw === "" ? undefined : Number(raw) });
          }}
        />
      </dd>
      <dt>Longitude</dt>
      <dd>
        <input
          className="meta-input"
          type="number"
          step="any"
          value={photo.longitude ?? ""}
          placeholder="e.g. -122.4194"
          onChange={(e) => {
            const raw = e.target.value.trim();
            onPatch({ longitude: raw === "" ? undefined : Number(raw) });
          }}
        />
      </dd>
      <dt>Copyright</dt>
      <dd>
        <input
          className="meta-input"
          value={photo.copyright}
          onChange={(e) => onPatch({ copyright: e.target.value })}
        />
      </dd>
      <dt>Creator</dt>
      <dd>
        <input
          className="meta-input"
          value={photo.creator}
          onChange={(e) => onPatch({ creator: e.target.value })}
        />
      </dd>
      <dt>Flag</dt>
      <dd>{photo.flag}</dd>
      <dt>Rating</dt>
      <dd>{photo.rating ? `${photo.rating} ★` : "unrated"}</dd>
    </dl>
  );
}
