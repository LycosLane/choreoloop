export type MediaKind = 'audio' | 'video' | 'youtube';

export type CountInMode = 'off' | '3s' | '5s' | '4beats' | '8beats';

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
  countInMode: CountInMode;
  repeatCountInOnLoop: boolean;
  bpm: number;
  pointA: number | null;
  pointB: number | null;
  loopEnabled: boolean;
}

export interface TrackMetadata {
  id: string;
  name: string;
  mimeType: string;
  mediaKind: MediaKind;
  youtubeId?: string;
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
  data: Blob | ArrayBuffer;
}
