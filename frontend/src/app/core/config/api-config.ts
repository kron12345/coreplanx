import { InjectionToken } from '@angular/core';

export interface ApiConfig {
  /**
   * Base URL for the REST API. Defaults to `/api` and can be overridden
   * through a custom provider (e.g. in main.ts or tests).
   */
  baseUrl: string;
}

export const API_CONFIG = new InjectionToken<ApiConfig>('API_CONFIG', {
  providedIn: 'root',
  factory: () => ({
    baseUrl: '/api',
  }),
});
