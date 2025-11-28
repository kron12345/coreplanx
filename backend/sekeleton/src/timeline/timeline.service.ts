import { Injectable } from '@nestjs/common';
import { ActivitiesService } from '../activities/activities.service';
import { ActivityDto } from '../activities/dto/activity.dto';
import { ServiceDto } from '../activities/dto/service.dto';

@Injectable()
export class TimelineService {
  constructor(private readonly activities: ActivitiesService) {}

  async loadTimeline(
    from: string,
    to: string,
    lod: 'activity' | 'service',
  ): Promise<{ activities?: ActivityDto[]; services?: ServiceDto[] }> {
    if (lod === 'service') {
      // Stub: aggregiere Services aus Activities
      const acts = await this.activities.getActivities(from, to);
      const grouped = new Map<string, ServiceDto>();
      acts.forEach((a) => {
        const sid = (a.attributes as any)?.serviceId || a.id;
        const existing = grouped.get(sid);
        const start = a.start;
        const end = a.end;
        if (!existing) {
          grouped.set(sid, {
            id: sid,
            type: (a.type === 'ABSENCE' ? 'ABSENCE' : 'SERVICE') as 'SERVICE' | 'ABSENCE',
            resourceId:
              (a.resourceAssignments?.[0]?.resourceId as string | undefined) ?? 'unknown',
            start,
            end,
            label: a.label || sid,
            status: a.status,
            attributes: { activityCount: 1 },
          });
        } else {
          existing.start = existing.start < start ? existing.start : start;
          existing.end =
            existing.end && end
              ? existing.end > end
                ? existing.end
                : end
              : existing.end || end;
          existing.attributes = { ...(existing.attributes ?? {}), activityCount: (existing.attributes?.activityCount as number | undefined ?? 1) + 1 };
        }
      });
      return { services: Array.from(grouped.values()) };
    }
    // lod=activity
    const activities = await this.activities.getActivities(from, to);
    return { activities };
  }
}
