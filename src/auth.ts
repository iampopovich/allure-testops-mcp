export interface TokenExchangeResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface TokenManagerOptions {
  baseUrl: string;
  apiToken: string;
  refreshSkewSeconds?: number;
}

import { logger } from "./logger.js";

export class TokenManager {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly refreshSkewMs: number;
  private cachedAccessToken: string | null = null;
  private expiresAtMs = 0;
  private refreshInFlight: Promise<string> | null = null;

  constructor(options: TokenManagerOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiToken = options.apiToken;
    this.refreshSkewMs = (options.refreshSkewSeconds ?? 60) * 1000;
  }

  async getAccessToken(): Promise<string> {
    if (this.hasValidCachedToken()) {
      logger.debug("using cached access token");
      return this.cachedAccessToken as string;
    }

    if (!this.refreshInFlight) {
      logger.debug("exchanging API token for JWT");
      this.refreshInFlight = this.exchangeToken().finally(() => {
        this.refreshInFlight = null;
      });
    } else {
      logger.debug("token exchange already in flight, waiting");
    }

    return this.refreshInFlight;
  }

  private hasValidCachedToken(): boolean {
    return (
      this.cachedAccessToken !== null &&
      Date.now() < this.expiresAtMs - this.refreshSkewMs
    );
  }

  private async exchangeToken(): Promise<string> {
    const start = Date.now();
    const form = new URLSearchParams();
    form.set("grant_type", "apitoken");
    form.set("scope", "openid");
    form.set("token", this.apiToken);

    const response = await fetch(`${this.baseUrl}/api/uaa/oauth/token`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      body: form,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, durationMs: Date.now() - start }, "token exchange failed");
      throw new Error(
        `Failed to exchange API token (HTTP ${response.status}): ${errorText}`,
      );
    }

    const tokenData = (await response.json()) as TokenExchangeResponse;
    if (!tokenData.access_token || !tokenData.expires_in) {
      throw new Error("Token exchange response is missing required fields.");
    }

    this.cachedAccessToken = tokenData.access_token;
    this.expiresAtMs = Date.now() + tokenData.expires_in * 1000;
    logger.debug({ expiresInS: tokenData.expires_in, durationMs: Date.now() - start }, "token exchange successful");
    return this.cachedAccessToken;
  }
}
