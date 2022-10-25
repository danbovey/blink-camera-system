export type BlinkCameraSystemOptions = {
  auth2fa?: boolean;
  debug?: boolean;
  deviceName?: string;
};

export interface BlinkDeviceResponse {
  id: number;
  name: string;
  type: string;
  network_id: number;
  region_id: string;
  status: string;
  enabled: boolean;
  thumbnail: string;
  signals?: Record<string, any>;
  battery: number;
  updated_at: number;
}

export interface BlinkSyncModule {
  id: number;
  network_id: number;
  status: 'online' | 'offline';
}

export type SummaryResponse = {
  networks: BlinkNetwork[];
  sync_modules: BlinkSyncModule[];
  cameras: BlinkDeviceResponse[];
  owls: BlinkDeviceResponse[];
};

export type BlinkNetwork = {
  id: number;
  name: string;
  armed: boolean;
};

export type VideoResponse = {
  camera_id: number;
  type: string;
  video_url: string;
  // TODO: string or number?
  created_at: number;
};

export type MotionEvent = {
  video: string;
  image: string;
  time: number;
};
