import axios, { AxiosError } from 'axios';

import { BlinkException } from './blink-exceptions';
import createBlinkUrls from './create-blink-urls';
import { BlinkDeviceResponse } from './types';

const request = axios.create({
  validateStatus: status => status >= 200 && status < 300
});

export default class BlinkDevice {
  urls: ReturnType<typeof createBlinkUrls>;

  private _data: BlinkDeviceResponse;
  private _thumbUrl: string;
  private _clipUrl: string;
  private _motion: Record<string, unknown> = {};
  private _authHeader: Record<string, string> = {};
  private _imageLink: string | null = null;
  private _armLink: string | null = null;

  constructor(
    data: BlinkDeviceResponse,
    urls: ReturnType<typeof createBlinkUrls>,
    authHeader: Record<string, string>
  ) {
    this.urls = urls;
    this._data = data;

    this._thumbUrl = `${this.urls.baseUrl}${data.thumbnail}.jpg`;
    this._clipUrl = `${this.urls.baseUrl}${data.thumbnail}.mp4`;

    this._authHeader = authHeader;

    const networkIdUrl = `${this.urls.networkUrl}${data.network_id}`;
    this._armLink = `${networkIdUrl}/camera/${data.id}/`;

    if (data.type === 'owl') {
      const owlUrl = `${this.urls.armUrl}${data.network_id}`;
      this._imageLink = `${owlUrl}/owls/${data.id}/thumbnail`;
      // TODO: Arm link?
    } else if (data.type === 'doorbell') {
      const doorbellUrl = `${this.urls.armUrl}${data.network_id}`;
      this._imageLink = `${doorbellUrl}/doorbells/${data.id}/thumbnail`;
    } else {
      this._imageLink = `${networkIdUrl}/camera/${data.id}/thumbnail`;
    }
  }

  get id() {
    return this._data.id;
  }

  get wifi() {
    return this._data.signals ? this._data.signals.wifi : null;
  }

  get lfr() {
    return this._data.signals ? this._data.signals.lfr : null;
  }

  get name() {
    return this._data.name;
  }

  // TODO: is this used?
  //  set name(value) {
  //    this._name = value;
  //  }

  get regionId() {
    return this._data.region_id;
  }

  get armed() {
    // TODO: Is status a string?
    return this._data.status === 'armed';
  }

  get enabled() {
    return this._data.enabled;
  }

  get clipUrl() {
    return this._clipUrl;
  }

  set clipUrl(value) {
    this._clipUrl = value;
  }

  get thumbnail() {
    return this._thumbUrl;
  }

  set thumbnail(value) {
    this._thumbUrl = value;
  }

  get temperature() {
    return this._data.signals ? this._data.signals.temp : null;
  }

  get battery() {
    return this._data.battery;
  }

  get imageLink() {
    return this._imageLink;
  }

  set imageLink(value) {
    this._imageLink = value;
  }

  get armLink() {
    return this._armLink;
  }

  set armLink(value) {
    this._armLink = value;
  }

  get header() {
    return this._authHeader;
  }

  set header(value) {
    this._authHeader = value;
  }

  get motion() {
    return this._motion;
  }

  set motion(value) {
    this._motion = value;
  }

  get updatedAt() {
    return this._data.updated_at;
  }

  get networkId() {
    return this._data.network_id;
  }

  // TODO: Is this needed?
  //  set networkId(value) {
  //    this._data.network_id = value;
  //  }

  snapPicture = async () => {
    if (!this._imageLink) {
      throw new BlinkException('Camera is not initialized');
    }

    let response;
    try {
      response = await request.post(this._imageLink, {}, { headers: this._authHeader });
    } catch (error) {
      throw new BlinkException(
        `Can't get snapshot from camera ${this._data.id} / ${this._data.name} with status code: ${
          (error as AxiosError).response?.status
        }`
      );
    }

    return response.data;
  };

  setMotionDetect = async (enable: boolean) => {
    let response;
    try {
      response = await request.post(
        `${this._armLink}${enable ? 'enable' : 'disable'}`,
        {},
        { headers: this._authHeader }
      );
    } catch (error) {
      throw new BlinkException(
        `Can't set motion detect for camera ${this._data.id} / ${
          this._data.name
        } with status code: ${(error as AxiosError).response?.status}`
      );
    }

    return response.data;
  };

  update = (values: BlinkDeviceResponse) => {
    this._data = values;
    this._thumbUrl = `${this.urls.baseUrl}${values['thumbnail']}.jpg`;
    this._clipUrl = `${this.urls.baseUrl}${values['thumbnail']}.mp4`;
  };

  imageRefresh = async () => {
    let response;
    try {
      response = await request.get(this.urls.homeUrl, { headers: this._authHeader });
    } catch (error) {
      throw new BlinkException(
        `Can't refresh thumbnail for camera ${this._data.id}:${this._data.name} with status code: ${
          (error as AxiosError).response?.status
        }`
      );
    }

    let cameras = response.data.cameras;
    cameras.forEach((camera: BlinkDeviceResponse) => {
      if (camera.id === this._data.id) {
        this._thumbUrl = `${this.urls.baseUrl}${camera.thumbnail}.jpg`;
        this._data.updated_at = camera.updated_at;
      }
    });

    return this._thumbUrl;
  };

  statusRefresh = async () => {
    let response;
    try {
      response = await request.post(`${this._armLink}status`, {}, { headers: this._authHeader });
    } catch (error) {
      throw new BlinkException(
        `Can't refresh status for camera ${this._data.id}:${this._data.name} with status code: ${
          (error as AxiosError).response?.status
        }`
      );
    }

    return response.data;
  };

  fetchImageData = async () => {
    let response;
    try {
      response = await request.get(this._thumbUrl, {
        headers: this._authHeader,
        responseType: 'arraybuffer'
      });
    } catch (error) {
      throw new BlinkException(
        `Can't refresh thumbnail for camera ${this._data.id} / ${
          this._data.name
        } with status code: ${(error as AxiosError).response?.status}`
      );
    }

    return response.data;
  };

  fetchVideoData = async () => {
    let response;
    try {
      response = await request.get(this.clipUrl, {
        headers: this._authHeader,
        responseType: 'arraybuffer'
      });
    } catch (error) {
      throw new BlinkException(
        `Can't refresh thumbnail for camera ${this._data.id} / ${
          this._data.name
        } with status code: ${(error as AxiosError).response?.status}`
      );
    }

    return response.data;
  };

  recordClip = async () => {
    let response;
    try {
      response = await request.post(`${this.armLink}clip`, {}, { headers: this._authHeader });
    } catch (error) {
      throw new BlinkException(
        `Can't record clip for camera ${this._data.id} / ${this._data.name} with status code: ${
          (error as AxiosError).response?.status
        }`
      );
    }

    return response.data;
  };
}
