import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideNativeDateAdapter } from '@angular/material/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { environment } from '../environments/environment';
import { API_CONFIG } from './core/config/api-config';
import { requestIdInterceptor } from './core/interceptors/request-id.interceptor';

import { routes } from './app.routes';

const API_PATH = '/api/v1';
const LOCAL_API_ORIGIN = 'http://localhost:3000';

function resolveApiBaseUrl(): string {
  const runtimeOverride = (globalThis as { __COREPLANX_API_BASE__?: string }).__COREPLANX_API_BASE__;
  if (runtimeOverride && runtimeOverride.trim().length > 0) {
    return runtimeOverride.trim();
  }

  if (typeof document !== 'undefined') {
    const metaOverride = document
      .querySelector('meta[name="coreplanx-api-base"]')
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

function resolveDebugStreamToken(): string | undefined {
  const runtimeOverride = (globalThis as { __COREPLANX_DEBUG_STREAM_TOKEN__?: string })
    .__COREPLANX_DEBUG_STREAM_TOKEN__;
  if (runtimeOverride && runtimeOverride.trim().length > 0) {
    return runtimeOverride.trim();
  }

  if (typeof document !== 'undefined') {
    const metaOverride = document
      .querySelector('meta[name="coreplanx-debug-token"]')
      ?.getAttribute('content')
      ?.trim();
    if (metaOverride) {
      return metaOverride;
    }
  }

  const envOverride = environment.debugStreamToken?.trim();
  if (envOverride) {
    return envOverride;
  }

  return undefined;
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideAnimationsAsync(),
    provideNativeDateAdapter(),
    provideHttpClient(withInterceptors([requestIdInterceptor])),
    {
      provide: API_CONFIG,
      useValue: { baseUrl: resolveApiBaseUrl(), debugStreamToken: resolveDebugStreamToken() },
    },
  ],
};
