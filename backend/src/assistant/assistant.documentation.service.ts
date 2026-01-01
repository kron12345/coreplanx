import { Inject, Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import * as path from 'path';
import { ASSISTANT_CONFIG } from './assistant.constants';
import type { AssistantConfig } from './assistant.config';
import type { AssistantUiContextDto } from './assistant.dto';

interface AssistantDocDescriptor {
  title: string;
  relativePath: string;
}

type MasterDataDocKey =
  | 'personnel'
  | 'timetable-years'
  | 'simulations'
  | 'vehicles'
  | 'topology';

const MASTER_DATA_DOCS: Record<MasterDataDocKey, AssistantDocDescriptor> = {
  personnel: {
    title: 'Stammdaten · Personal',
    relativePath: 'docs/assistant/stammdaten-personal.md',
  },
  'timetable-years': {
    title: 'Stammdaten · Fahrplanjahre',
    relativePath: 'docs/assistant/stammdaten-fahrplanjahre.md',
  },
  simulations: {
    title: 'Stammdaten · Simulationen',
    relativePath: 'docs/assistant/stammdaten-simulationen.md',
  },
  vehicles: {
    title: 'Stammdaten · Fahrzeuge',
    relativePath: 'docs/assistant/stammdaten-fahrzeuge.md',
  },
  topology: {
    title: 'Stammdaten · Topologie',
    relativePath: 'docs/assistant/stammdaten-topologie.md',
  },
};

const MASTER_DATA_TITLE_TO_DOC_KEY: Record<string, MasterDataDocKey> = {
  Personal: 'personnel',
  Fahrplanjahre: 'timetable-years',
  Simulationen: 'simulations',
  Fahrzeuge: 'vehicles',
  Topologie: 'topology',
};

@Injectable()
export class AssistantDocumentationService {
  constructor(@Inject(ASSISTANT_CONFIG) private readonly config: AssistantConfig) {}

  resolveDocumentation(
    uiContext?: AssistantUiContextDto,
  ): { title: string; sourcePath: string; markdown: string; subtopic: string } | null {
    const docKey = this.resolveDocKey(uiContext);
    if (!docKey) {
      return null;
    }

    const descriptor = MASTER_DATA_DOCS[docKey];
    if (!descriptor) {
      return null;
    }

    const markdown = this.readMarkdownFromRepo(descriptor.relativePath);
    if (!markdown) {
      return null;
    }

    const breadcrumbs = uiContext?.breadcrumbs ?? [];
    const subtopic = uiContext?.docSubtopic?.trim() || breadcrumbs[2]?.trim() || '';
    return {
      title: descriptor.title,
      sourcePath: descriptor.relativePath,
      markdown,
      subtopic,
    };
  }

  buildDocumentationMessages(
    uiContext?: AssistantUiContextDto,
    options?: { maxChars?: number },
  ): Array<{ role: 'system'; content: string }> {
    const resolved = this.resolveDocumentation(uiContext);
    if (!resolved) {
      return [];
    }
    return this.buildDocumentationMessagesFromResolved(resolved, options);
  }

  buildDocumentationMessagesFromResolved(resolved: {
    title: string;
    sourcePath: string;
    markdown: string;
    subtopic: string;
  }, options?: { maxChars?: number }): Array<{ role: 'system'; content: string }> {
    const excerpt = this.buildExcerpt(resolved.markdown, resolved.subtopic);
    const maxChars = this.resolveDocBudget(options?.maxChars);
    if (maxChars <= 0) {
      return [];
    }
    const limited = this.truncate(excerpt, maxChars);

    return [
      {
        role: 'system',
        content: `CorePlanX Dokumentation (${resolved.title}, Quelle: ${resolved.sourcePath})\n\n${limited}`,
      },
    ];
  }

  private extractMasterDataArea(breadcrumbs: string[]): string | null {
    const normalized = breadcrumbs.map((crumb) => crumb?.trim?.() ?? '').filter((c) => c.length);
    if (!normalized.length) {
      return null;
    }
    const masterIndex = normalized.findIndex(
      (entry) => entry.toLowerCase() === 'stammdaten',
    );
    if (masterIndex < 0) {
      return null;
    }
    return normalized[masterIndex + 1] ?? null;
  }

  private resolveDocKey(uiContext?: AssistantUiContextDto): MasterDataDocKey | null {
    const explicit = uiContext?.docKey?.trim();
    if (explicit && explicit in MASTER_DATA_DOCS) {
      return explicit as MasterDataDocKey;
    }

    const breadcrumbs = uiContext?.breadcrumbs ?? [];
    if (!breadcrumbs.length) {
      return null;
    }

    const masterDataTitle = this.extractMasterDataArea(breadcrumbs);
    if (!masterDataTitle) {
      return null;
    }

    return MASTER_DATA_TITLE_TO_DOC_KEY[masterDataTitle] ?? null;
  }

  private readMarkdownFromRepo(relativePath: string): string | null {
    try {
      const repoRoot = path.resolve(__dirname, '..', '..', '..');
      const absolutePath = path.resolve(repoRoot, relativePath);
      return readFileSync(absolutePath, 'utf8');
    } catch {
      return null;
    }
  }

  private buildExcerpt(markdown: string, subtopic: string): string {
    const sections: string[] = [];

    const navigation = this.extractSection(markdown, 'Wo finde ich das?');
    if (navigation) {
      sections.push(navigation);
    }

    const overview = this.extractSection(markdown, 'Überblick');
    if (overview) {
      sections.push(overview);
    } else {
      const purpose = this.extractSection(markdown, 'Zweck');
      if (purpose) {
        sections.push(purpose);
      }
    }

    if (subtopic) {
      const topic = this.extractSection(markdown, subtopic);
      if (topic) {
        sections.push(topic);
      }
    }

    if (sections.length) {
      return sections.join('\n\n');
    }

    return markdown;
  }

  private extractSection(markdown: string, wantedHeading: string): string | null {
    const wanted = wantedHeading.trim().toLowerCase();
    if (!wanted) {
      return null;
    }

    const lines = markdown.split(/\r?\n/);
    const headingPattern = /^(#{1,6})\s+(.+?)\s*$/;

    let startIndex = -1;
    let startLevel = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const match = headingPattern.exec(lines[i] ?? '');
      if (!match) {
        continue;
      }
      const level = match[1]?.length ?? 0;
      const headingText = (match[2] ?? '').trim();
      const normalized = headingText.toLowerCase();
      const matches =
        normalized === wanted ||
        normalized.startsWith(`${wanted}:`) ||
        normalized.startsWith(`${wanted} `);
      if (matches) {
        startIndex = i;
        startLevel = level;
        break;
      }
    }

    if (startIndex < 0) {
      return null;
    }

    let endIndex = lines.length;
    for (let i = startIndex + 1; i < lines.length; i += 1) {
      const match = headingPattern.exec(lines[i] ?? '');
      if (!match) {
        continue;
      }
      const level = match[1]?.length ?? 0;
      if (level <= startLevel) {
        endIndex = i;
        break;
      }
    }

    return lines.slice(startIndex, endIndex).join('\n').trim();
  }

  private truncate(value: string, maxChars: number): string {
    if (value.length <= maxChars) {
      return value;
    }
    return `${value.slice(0, Math.max(0, maxChars - 12)).trimEnd()}\n\n… (gekürzt)`;
  }

  private resolveDocBudget(maxChars?: number): number {
    if (maxChars === undefined) {
      return this.config.maxDocChars;
    }
    return Math.max(0, Math.min(maxChars, this.config.maxDocChars));
  }
}
