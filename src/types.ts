export type MediaKind = 'audio' | 'video' | 'youtube';

export type CountInMode = '3s' | '5s' | 'beats';

export type BeatSubdivision = 2 | 3 | 4 | 6 | 8 | 16;

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
  countInEnabled: boolean;
  countInMode: CountInMode;
  repeatCountInOnLoop: boolean;
  bpm: number;
  beatCount: number;
  beatSubdivision: BeatSubdivision;
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
