export type MediaKind = 'audio' | 'video' | 'youtube';

export type CountInMode = '3s' | '5s' | 'beats';

export type CountInTone = 'woodblock' | 'click' | 'beep';

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
  countInTone: CountInTone;
  countInVolume: number;
  pointA: number | null;
  pointB: number | null;
  loopEnabled: boolean;
}

export interface TrackMetadata {
  id: string;
  name: string;
  fileName?: string;
  mimeType: string;
  mediaKind: MediaKind;
  youtubeId?: string;
  size: number;
  lastModified?: number;
  hasOfflineCopy?: boolean;
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
