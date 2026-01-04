import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { ClientIdentityService } from '../services/client-identity.service';

const REQUEST_ID_HEADER = 'X-Request-Id';
const CLIENT_REQUEST_ID_HEADER = 'X-Client-Request-Id';

export const requestIdInterceptor: HttpInterceptorFn = (req, next) => {
  const identity = inject(ClientIdentityService);
  const existingRequestId = req.headers.get(REQUEST_ID_HEADER);
  const requestId = existingRequestId ?? generateRequestId();
  const existingClientRequestId = req.headers.get(CLIENT_REQUEST_ID_HEADER);
  const clientRequestId =
    existingClientRequestId ??
    `${identity.userId()}|${identity.connectionId()}|${requestId}`;

  let headers = req.headers;
  if (!existingRequestId) {
    headers = headers.set(REQUEST_ID_HEADER, requestId);
  }
  if (!existingClientRequestId) {
    headers = headers.set(CLIENT_REQUEST_ID_HEADER, clientRequestId);
  }
  return next(req.clone({ headers }));
};

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
