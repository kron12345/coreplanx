import { Pipe, PipeTransform } from '@angular/core';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

@Pipe({
  name: 'markdown',
  standalone: true,
})
export class MarkdownPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) {
      return '';
    }
    try {
      const rendered = marked.parse(value, {
        async: false,
        gfm: true,
        breaks: true,
      });
      const html = typeof rendered === 'string' ? rendered : value;
      return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    } catch {
      return value;
    }
  }
}
