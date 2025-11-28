import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ClientIdentityService {
  private static readonly USER_STORAGE_KEY = 'order-mgmt-user-id';
  private static readonly CONNECTION_STORAGE_KEY = 'order-mgmt-connection-id';

  private readonly userIdValue: string;
  private readonly connectionIdValue: string;

  constructor() {
    this.userIdValue = this.restoreOrCreateId(ClientIdentityService.USER_STORAGE_KEY, this.localStorage());
    this.connectionIdValue = this.restoreOrCreateId(
      ClientIdentityService.CONNECTION_STORAGE_KEY,
      this.sessionStorage(),
    );
  }

  /**
   * @deprecated Use userId() for the persisted identifier.
   */
  id(): string {
    return this.userIdValue;
  }

  userId(): string {
    return this.userIdValue;
  }

  connectionId(): string {
    return this.connectionIdValue;
  }

  private restoreOrCreateId(key: string, storage: Storage | null): string {
    if (!storage) {
      return this.generateId();
    }
    try {
      const stored = storage.getItem(key);
      if (stored && stored.length > 0) {
        return stored;
      }
      const fresh = this.generateId();
      storage.setItem(key, fresh);
      return fresh;
    } catch {
      return this.generateId();
    }
  }

  private localStorage(): Storage | null {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  private sessionStorage(): Storage | null {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }

  private generateId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
