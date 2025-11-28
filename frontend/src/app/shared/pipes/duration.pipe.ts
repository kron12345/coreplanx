import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'duration',
  standalone: true,
})
export class DurationPipe implements PipeTransform {
  transform(
    value: number | string | Date,
    end?: number | string | Date,
  ): string {
    const durationMs =
      end !== undefined
        ? Math.max(0, this.parseDate(end).getTime() - this.parseDate(value).getTime())
        : typeof value === 'number'
          ? value
          : 0;

    if (!durationMs) {
      return '0 min';
    }
    const totalMinutes = Math.floor(durationMs / 60000);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);
    const seconds = Math.floor((durationMs % 60000) / 1000);

    if (hours > 0 && minutes > 0) {
      return `${hours} h ${minutes} min`;
    }
    if (hours > 0) {
      return `${hours} h`;
    }
    if (minutes > 0) {
      return `${minutes} min`;
    }
    return `${seconds} s`;
  }

  private parseDate(value: number | string | Date): Date {
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'number') {
      return new Date(value);
    }
    return new Date(value);
  }
}

