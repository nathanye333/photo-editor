import { photoThumbSrc } from "../catalog/media";
import type { Photo } from "../catalog/types";

type MapViewProps = {
  photos: Photo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
};

type Point = { photo: Photo; x: number; y: number };

function locatedPhotos(photos: Photo[]): Photo[] {
  return photos.filter(
    (p) => p.latitude != null && p.longitude != null && Number.isFinite(p.latitude) && Number.isFinite(p.longitude),
  );
}

function projectPoints(photos: Photo[], width: number, height: number, pad: number): Point[] {
  const lats = photos.map((p) => p.latitude!);
  const lngs = photos.map((p) => p.longitude!);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs);
  let maxLng = Math.max(...lngs);
  if (minLat === maxLat) {
    minLat -= 0.01;
    maxLat += 0.01;
  }
  if (minLng === maxLng) {
    minLng -= 0.01;
    maxLng += 0.01;
  }
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  return photos.map((photo) => {
    const x = pad + ((photo.longitude! - minLng) / (maxLng - minLng)) * innerW;
    const y = pad + (1 - (photo.latitude! - minLat) / (maxLat - minLat)) * innerH;
    return { photo, x, y };
  });
}

export function MapView(props: MapViewProps) {
  const located = locatedPhotos(props.photos);
  if (!located.length) {
    return (
      <div className="library-view map-view empty">
        No photos with GPS coordinates. Import geotagged images to see them on the map.
      </div>
    );
  }

  const width = 960;
  const height = 560;
  const pad = 32;
  const points = projectPoints(located, width, height, pad);

  return (
    <div className="library-view map-view">
      <div className="map-toolbar">
        <span>{located.length} geotagged photo{located.length === 1 ? "" : "s"}</span>
      </div>
      <svg className="map-canvas" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Photo map">
        <rect x={0} y={0} width={width} height={height} className="map-bg" />
        {points.map(({ photo, x, y }) => {
          const selected = photo.id === props.selectedId;
          return (
            <g key={photo.id} className={`map-pin${selected ? " sel" : ""}`}>
              <circle
                cx={x}
                cy={y}
                r={selected ? 9 : 6}
                onClick={() => props.onSelect(photo.id)}
                onDoubleClick={() => props.onOpen(photo.id)}
              />
              {selected ? (
                <foreignObject x={x + 12} y={y - 48} width={120} height={90}>
                  <button type="button" className="map-thumb" onClick={() => props.onOpen(photo.id)}>
                    {photoThumbSrc(photo) && !photo.missing ? (
                      <img src={photoThumbSrc(photo)} alt="" />
                    ) : (
                      <span>—</span>
                    )}
                  </button>
                </foreignObject>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
