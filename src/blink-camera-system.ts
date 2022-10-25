import readline from 'readline';
import axios, { AxiosError, AxiosResponse } from 'axios';

import { BLINK_URL, LOGIN_URL, LOGIN_URL_2FA, SIZE_NOTIFICATION_KEY } from './constants';
import BlinkDevice from './blink-device';
import { BlinkException, BlinkAuthenticationException } from './blink-exceptions';
import createBlinkUrls from './create-blink-urls';
import guid from './guid';
import {
  BlinkCameraSystemOptions,
  BlinkNetwork,
  MotionEvent,
  SummaryResponse,
  VideoResponse
} from './types';

const request = axios.create({
  validateStatus: status => status >= 200 && status < 300
});

export default class BlinkCameraSystem {
  _username: string;
  _password: string;
  _token: string | null = null;
  _authHeader: Record<string, string> | null = null;
  _networks: BlinkNetwork[] = [];
  _accountId: number | null = null;
  _region: string | null = null;
  _regionId: string | null = null;
  _host: string | null = null;
  _events: unknown[] = [];
  _devices: BlinkDevice[] = [];
  _deviceId: string;
  _auth2fa = false;
  _verificationTimeout = 1e3 * 60;

  debug: boolean;
  deviceName: string;
  urls: ReturnType<typeof createBlinkUrls> = {
    baseUrl: '',
    networkUrl: '',
    armUrl: '',
    videoUrl: '',
    homeUrl: ''
  };

  constructor(
    username: string,
    password: string,
    deviceId: string,
    options: BlinkCameraSystemOptions
  ) {
    this._username = username;
    this._password = password;
    this._deviceId = deviceId;
    this._auth2fa = options.auth2fa ?? false;

    this.debug = options.debug ?? false;
    this.deviceName = options.deviceName ?? 'node-blink-camera-system';

    Object.assign(this, options);
  }

  get devices() {
    return this._devices;
  }

  get networks() {
    return this._networks;
  }

  get accountId() {
    return this._accountId;
  }

  get region() {
    return this._region;
  }

  get regionId() {
    return this._regionId;
  }

  refresh = async () => {
    const refreshJobs = this._devices.map(device => device.statusRefresh());
    await Promise.all(refreshJobs);

    const summaries = await this.getSummary();

    return Promise.all(
      this._devices.map(device => {
        let summaryDevice = summaries.cameras.find(c => c.id === device.id);
        if (!summaryDevice) {
          summaryDevice = summaries.owls.find(o => o.id === device.id);
        }
        // TODO: Add other device types like owls

        if (summaryDevice) {
          return device.update(summaryDevice);
        }
      })
    );
  };

  getSummary = async () => {
    const networks = this.networks.map(n => n.id);

    this.debug && console.log('[blink-camera-system] Included networks:', JSON.stringify(networks));

    if (!this._authHeader) {
      throw new BlinkException('Authentication token must be set');
    }

    let response;
    try {
      response = await request.get(this.urls.homeUrl, {
        headers: this._authHeader
      });
    } catch (error) {
      throw new BlinkException(`Can't retrieve system summary`);
    }

    const summary = response.data as SummaryResponse;

    this.debug && console.log('[blink-camera-system] summary:', summary);

    // Filter based on networks that were selected
    summary.networks = summary.networks.filter(network =>
      this.networks.find(n => n.id == network.id)
    );
    summary.sync_modules = summary.sync_modules.filter(syncModule =>
      this.networks.find(n => n.id === syncModule.network_id)
    );
    summary.cameras = summary.cameras.filter(camera =>
      this.networks.find(n => n.id === camera.network_id)
    );
    summary.owls = summary.owls.filter(owl => this.networks.find(n => n.id === owl.network_id));

    return summary;
  };

  getCameraThumbs = async () => {
    let thumbs: Record<string, string> = {};

    await this.refresh();
    this._devices.forEach(device => {
      thumbs[device.id] = device.thumbnail;
    });

    return thumbs;
  };

  isOnline = async (networkIds = []) => {
    const networks = networkIds.length ? networkIds : this.networks.map(_ => _.id);

    const summaries = await this.getSummary();
    const onlineStatus: Record<number, boolean> = {};
    summaries.sync_modules.forEach(syncModule => {
      if (networks.includes(syncModule.network_id)) {
        onlineStatus[syncModule.network_id] = syncModule.status === 'online' ? true : false;
      }
    });

    return onlineStatus;
  };

  getLastMotions = async () => {
    const videos = await this.getVideos();

    const result: Record<number, MotionEvent> = {};
    videos.forEach(video => {
      const camera_id = video.camera_id;
      const camera = this._devices.find(d => d.id === camera_id);
      if (!camera) {
        throw new BlinkException('Camera not found');
      }

      if (video.type === 'motion') {
        const url = `${this.urls.baseUrl}${video.video_url}`;
        result[camera_id] = camera.motion = {
          video: url,
          image: url.replace(/\.[^.]+$]/, '.jpg'),
          time: video.created_at
        };
      }
    });
    return result;
  };

  isArmed = async () => {
    const summaries = await this.getSummary();
    const networkIds = this.networks.map(n => n.id);

    const result: Record<number, boolean> = {};
    summaries.networks.forEach(el => {
      if (networkIds.includes(el.id)) {
        result[el.id] = el.armed;
      }
    });

    return result;
  };

  setArmed = async (value = true, networkIds: number[] = []) => {
    const requestedNetworkIds = networkIds.length ? networkIds : this.networks.map(n => n.id);

    let armed: Record<number, boolean> = {};
    const results = await Promise.all(
      requestedNetworkIds.map(async networkId => {
        const state = value ? 'arm' : 'disarm';

        this.debug &&
          console.log(
            '[blink-camera-system] arm url: ' + this.urls.armUrl + networkId + '/state/' + state
          );

        let response;
        try {
          response = await request.post(
            `${this.urls.armUrl}${networkId}/state/${state}`,
            {},
            { headers: this._authHeader! }
          );
        } catch (error) {
          throw new BlinkException(`Can't ${state} the network: ${networkId}`);
        }

        return response.data;
      })
    );

    // TODO: Expecting response.data to be a boolean
    this.debug && console.log('[blink-camera-system] setArmed:', results);

    results.forEach((result, index) => {
      armed[requestedNetworkIds[index]] = result;
    });

    return armed;
  };

  getVideos = async (page = 0, since = new Date(2008)) => {
    // Blink was founded in 2009
    let response;
    try {
      response = await request.get(
        `${this.urls.videoUrl}?since=${since.toISOString()}&page=${page}`,
        {
          headers: this._authHeader || {}
        }
      );
    } catch (error) {
      throw new BlinkException(`Can't fetch videos`);
    }

    return response.data as VideoResponse[];
  };

  getCameras = async () => {
    const summaries = await this.getSummary();

    this.debug && console.log('[blink-camera-system] getCameras:', summaries.cameras);
    this.debug && console.log('[blink-camera-system] getCameras (owls):', summaries.owls);

    const blinkDevices = [...summaries.cameras, ...summaries.owls];

    blinkDevices.forEach(device => {
      device.region_id = this._regionId as string;

      const newDevice = new BlinkDevice(device, this.urls, this._authHeader!);

      const existingDeviceIndex = this._devices.findIndex(d => d.id === newDevice.id);
      if (existingDeviceIndex > -1) {
        this._devices.splice(existingDeviceIndex, 1);
      }

      this._devices.push(newDevice);
    });

    return this._devices;
  };

  init = async (name_or_id?: string | number) => {
    if (!((this._username && this._password) || (this._token && this._regionId))) {
      throw new BlinkAuthenticationException(
        '(_username, _password) or (_token, _regionId) are required for system setup'
      );
    }

    if (this._token) {
      this._setupWithToken();
    } else {
      await this._getAuthToken();
    }

    await this.getIDs(name_or_id);
    await this.getCameras();
  };

  _setupWithToken = () => {
    this._host = `rest-${this._regionId}.${BLINK_URL}`;
    this._authHeader = {
      'token-auth': this._token!
    };
    this.urls = createBlinkUrls(this._accountId!, this._regionId!);
  };

  _getAuthToken = async (retries = 0) => {
    if (typeof this._username != 'string') {
      throw new BlinkAuthenticationException('Username must be a string');
    }
    if (typeof this._password != 'string') {
      throw new BlinkAuthenticationException('Password must be a string');
    }
    if (typeof this._deviceId != 'string') {
      throw new BlinkAuthenticationException('Device ID must be a string');
    }

    let headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    const notificationKey = guid(SIZE_NOTIFICATION_KEY);
    const data = {
      email: this._username,
      password: this._password,
      notification_key: notificationKey,
      unique_id: this._deviceId,
      app_version: '6.16.0',
      client_name: this.deviceName,
      client_type: 'android',
      device_identifier: this._deviceId,
      device_name: this.deviceName,
      os_version: '13.0.0',
      reauth: 'true'
    };

    const saveAuthResult = () => {
      this._host = `rest-${this._regionId}.${BLINK_URL}`;
      this._authHeader = {
        'token-auth': this._token!
      };

      this.urls = createBlinkUrls(this._accountId!, this._regionId!);
    };

    let response: AxiosResponse;
    try {
      response = await request.post(this._auth2fa ? LOGIN_URL_2FA : LOGIN_URL, data, { headers });
    } catch (error) {
      throw new BlinkAuthenticationException(
        `Authentication problem (response): ${JSON.stringify((error as AxiosError).response?.data)}`
      );
    }

    const { account } = response.data;
    if (account.account_verification_required || account.client_verification_required) {
      if (!this._auth2fa) {
        if (retries === 1) {
          throw new BlinkAuthenticationException(
            `Authentication problem (retry): verification timeout`
          );
        }

        return new Promise((resolve, reject) => {
          setTimeout(() => {
            this._getAuthToken(retries + 1).then(resolve, reject);
          }, this._verificationTimeout);
        });
      }

      // TODO: Accept parameter to use this library or use a different argument later for usage in an API
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      return new Promise(resolve => {
        return rl.question(`Enter the verification code sent to ${this._username}: `, async pin => {
          this._regionId = account.tier;
          this._region = account.region;
          this._token = response.data.auth.token as string;
          this._accountId = account.account_id;

          this.debug &&
            console.log('[blink-camera-system] body.account.account_id', account.account_id);
          const urls = createBlinkUrls(account.account_id, account.tier);
          headers['token-auth'] = this._token;

          const pinUrl = `${urls.baseUrl}/api/v4/account/${account.account_id}/client/${account.client_id}/pin/verify`;
          this.debug && console.log('[blink-camera-system] pin verify url:', pinUrl);
          this.debug && console.log('[blink-camera-system] headers: ', headers);
          this.debug && console.log('[blink-camera-system] pin: ', pin);

          let verifyResponse;
          try {
            verifyResponse = await request.post(pinUrl, { pin: `${pin}` }, { headers });
          } catch (error) {
            throw new BlinkAuthenticationException(
              `Authentication problem (verify response): ${JSON.stringify(
                (error as AxiosError).response?.data
              )}`
            );
          }

          saveAuthResult();

          rl.close();
          return resolve(true);
        });
      });
    }

    if (!account.region) {
      this.debug &&
        console.log('[blink-camera-system] response with no account region ', response.data);
      throw new BlinkAuthenticationException(response.data);
    }

    this._regionId = account.tier;
    this._region = account.region;
    this._token = response.data.auth.token;
    this._accountId = account.account_id;

    saveAuthResult();
  };

  getIDs = async (name_or_id?: string | number) => {
    if (!this._authHeader) {
      throw new BlinkException('You have to be authenticated before calling this method');
    }

    let response;
    try {
      response = await request.get(this.urls.homeUrl, { headers: this._authHeader });
    } catch (error) {
      throw new BlinkException(
        `Can't retrieve system status: ${JSON.stringify((error as AxiosError).response?.data)}`
      );
    }

    let foundNetwork = false;
    if (typeof name_or_id !== 'undefined') {
      response.data.networks.forEach((n: BlinkNetwork) => {
        if (n.id == name_or_id || n.name == name_or_id) {
          foundNetwork = true;
          this._networks.push(n);
        }
      });

      if (!foundNetwork) {
        throw new BlinkException(`No network found for ${name_or_id}`);
      }
    } else {
      if (!response.data.networks.length) {
        throw new BlinkException('No networks found');
      }
      this._networks = response.data.networks;
    }

    this.debug && console.log('[blink-camera-system] account: ' + response.data.account);

    this._accountId = response.data.account.id;
    this.urls = createBlinkUrls(this._accountId!, this._regionId!);
  };
}
