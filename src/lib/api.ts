type InsForgeLikeClient = {
  getHttpClient?: () => {
    getHeaders?: () => Record<string, string>;
  };
};

export function buildApiRequestInit(client: InsForgeLikeClient): RequestInit {
  const sdkHeaders = client.getHttpClient?.().getHeaders?.() || {};
  const authorization = sdkHeaders.Authorization || sdkHeaders.authorization;

  return {
    headers: authorization ? { Authorization: authorization } : {},
  };
}
