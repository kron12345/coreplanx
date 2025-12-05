import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_CONFIG } from '../config/api-config';
import { ActivityTypeDefinition } from '../services/activity-type.service';

@Injectable({ providedIn: 'root' })
export class ActivityCatalogApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  list(): Promise<ActivityTypeDefinition[]> {
    return this.http
      .get<ActivityTypeDefinition[]>(`${this.baseUrl()}/activity-catalog`)
      .toPromise()
      .then((res) => res ?? []);
  }

  replaceAll(definitions: ActivityTypeDefinition[]): Promise<void> {
    return this.http
      .put<void>(`${this.baseUrl()}/activity-catalog`, definitions ?? [])
      .toPromise();
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }
}
