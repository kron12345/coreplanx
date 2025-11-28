import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideNativeDateAdapter } from '@angular/material/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';
import { API_CONFIG } from './core/config/api-config';

import { routes } from './app.routes';

const API_PATH = '/api';
const LOCAL_API_ORIGIN = 'http://localhost:3000';

function resolveApiBaseUrl(): string {
  const runtimeOverride = (globalThis as { __ORDER_MGMT_API_BASE__?: string }).__ORDER_MGMT_API_BASE__;
  if (runtimeOverride && runtimeOverride.trim().length > 0) {
    return runtimeOverride.trim();
  }

  if (typeof document !== 'undefined') {
    const metaOverride = document
      .querySelector('meta[name="order-mgmt-api-base"]')
      ?.getAttribute('content')
      ?.trim();
    if (metaOverride) {
      return metaOverride;
    }
  }

  const envOverride = environment.apiBaseUrl?.trim();
  if (envOverride) {
    return envOverride;
  }

  if (typeof window !== 'undefined') {
    const { hostname, port } = window.location;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    if (isLocalhost && (port === '' || port === '4200')) {
      return `${LOCAL_API_ORIGIN}${API_PATH}`;
    }
  }

  return API_PATH;
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideAnimationsAsync(),
    provideNativeDateAdapter(),
    provideHttpClient(),
    { provide: API_CONFIG, useValue: { baseUrl: resolveApiBaseUrl() } },
  ],
};
