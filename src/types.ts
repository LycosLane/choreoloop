export type MediaKind = 'audio' | 'video';

export interface LoopBookmark {
  id: string;
  name: string;
  start: number;
  end: number;
  createdAt: number;
}

export interface TrackSettings {
  speed: number;
  mirror: boolean;
  countInSeconds: number;
  pointA: number | null;
  pointB: number | null;
  loopEnabled: boolean;
}

export interface TrackMetadata {
  id: string;
  name: string;
  mimeType: string;
  mediaKind: MediaKind;
  size: number;
  duration: number;
  createdAt: number;
  updatedAt: number;
  bookmarks: LoopBookmark[];
  settings: TrackSettings;
}

export interface TrackMediaRecord {
  id: string;
  mimeType: string;
  data: ArrayBuffer;
}
