import { BLINK_URL } from './constants';

export default (accountId: number, regionId: string) => {
  const baseUrl = `https://rest-${regionId}.${BLINK_URL}`;

  return {
    baseUrl,
    networkUrl: `${baseUrl}/network/`,
    armUrl: `${baseUrl}/api/v1/accounts/${accountId}/networks/`,
    videoUrl: `${baseUrl}/api/v1/accounts/${accountId}/media/changed`,
    homeUrl: `${baseUrl}/api/v3/accounts/${accountId}/homescreen`
  };
};
