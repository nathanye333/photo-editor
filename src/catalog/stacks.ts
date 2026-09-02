import { captureTime } from "./filter";
import { isMasterPhoto, type Photo } from "./types";

/** Max gap between captures to auto-group into one stack. */
export const BURST_STACK_MS = 2000;

export function stackMembers(photos: Photo[], stackId: string): Photo[] {
  return photos
    .filter((p) => p.stackId === stackId)
    .sort((a, b) => (a.stackIndex ?? 0) - (b.stackIndex ?? 0));
}

export function stackCount(photos: Photo[], stackId: string): number {
  return photos.filter((p) => p.stackId === stackId).length;
}

/** Collapse stacks to cover photos unless the stack is expanded. */
export function collapseStacks(photos: Photo[], expanded: ReadonlySet<string>): Photo[] {
  const covers = new Map<string, Photo>();
  const singles: Photo[] = [];
  for (const photo of photos) {
    if (!photo.stackId) {
      singles.push(photo);
      continue;
    }
    if (expanded.has(photo.stackId)) {
      singles.push(photo);
      continue;
    }
    const current = covers.get(photo.stackId);
    if (!current || (photo.stackIndex ?? 0) < (current.stackIndex ?? 0)) {
      covers.set(photo.stackId, photo);
    }
  }
  return [...singles, ...covers.values()];
}

/**
 * Auto-group burst sequences in a folder. Returns photos whose stack fields changed.
 */
export function assignBurstStacks(existing: Photo[], added: Photo[]): Photo[] {
  const touched = new Map<string, Photo>();
  const catalog = [...existing];
  const masters = added.filter(isMasterPhoto);

  for (const photo of masters) {
    const t = captureTime(photo);
    const peers = catalog
      .filter((p) => p.folder === photo.folder && isMasterPhoto(p) && p.id !== photo.id)
      .filter((p) => Math.abs(captureTime(p) - t) <= BURST_STACK_MS);

    const stackedPeer = peers.find((p) => p.stackId);
    if (stackedPeer?.stackId) {
      const members = [...catalog, ...touched.values()].filter((p) => p.stackId === stackedPeer.stackId);
      const nextIndex = Math.max(0, ...members.map((p) => p.stackIndex ?? 0)) + 1;
      const updated = { ...photo, stackId: stackedPeer.stackId, stackIndex: nextIndex };
      touched.set(photo.id, updated);
      catalog.push(updated);
      continue;
    }

    const loosePeer = peers.find((p) => !p.stackId);
    if (loosePeer) {
      const stackId = crypto.randomUUID();
      const peerUpdate = { ...loosePeer, stackId, stackIndex: 0 };
      const photoUpdate = { ...photo, stackId, stackIndex: 1 };
      touched.set(loosePeer.id, peerUpdate);
      touched.set(photo.id, photoUpdate);
      const pi = catalog.findIndex((p) => p.id === loosePeer.id);
      if (pi >= 0) catalog[pi] = peerUpdate;
      catalog.push(photoUpdate);
      continue;
    }

    const batchPeer = [...touched.values()].find(
      (p) =>
        p.folder === photo.folder &&
        isMasterPhoto(p) &&
        p.id !== photo.id &&
        Math.abs(captureTime(p) - t) <= BURST_STACK_MS,
    );
    if (batchPeer?.stackId) {
      const members = [...touched.values()].filter((p) => p.stackId === batchPeer.stackId);
      const nextIndex = Math.max(0, ...members.map((p) => p.stackIndex ?? 0)) + 1;
      const updated = { ...photo, stackId: batchPeer.stackId, stackIndex: nextIndex };
      touched.set(photo.id, updated);
      catalog.push(updated);
    }
  }

  return [...touched.values()];
}

/** Stack selected master photos into one manual stack. */
export function stackPhotos(photos: Photo[], ids: string[]): Photo[] {
  const masters = ids
    .map((id) => photos.find((p) => p.id === id))
    .filter((p): p is Photo => !!p && isMasterPhoto(p));
  if (masters.length < 2) return [];

  const stackId = crypto.randomUUID();
  return masters
    .sort((a, b) => captureTime(a) - captureTime(b))
    .map((photo, index) => ({ ...photo, stackId, stackIndex: index }));
}
