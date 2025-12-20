import { Directive, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';

type IgnoreEntry = { count: number; until: number };
const IGNORED_SCROLL_WINDOW_MS = 80;
const ignoredScrollEvents = new WeakMap<HTMLElement, IgnoreEntry>();

function ignoreNextScrollEvent(element: HTMLElement): void {
  const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  const until = now + IGNORED_SCROLL_WINDOW_MS;
  const existing = ignoredScrollEvents.get(element);
  if (existing) {
    existing.count += 1;
    existing.until = Math.max(existing.until, until);
    return;
  }
  ignoredScrollEvents.set(element, { count: 1, until });
}

function consumeIgnoredScrollEvent(element: HTMLElement): boolean {
  const entry = ignoredScrollEvents.get(element);
  if (!entry) {
    return false;
  }
  const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  if (now > entry.until) {
    ignoredScrollEvents.delete(element);
    return false;
  }
  entry.count -= 1;
  if (entry.count <= 0) {
    ignoredScrollEvents.delete(element);
  }
  return true;
}

@Directive({
  selector: '[appTrackHorizontalScroll]',
  standalone: true,
  exportAs: 'appTrackHorizontalScroll',
})
export class TrackHorizontalScrollDirective implements OnInit, OnDestroy {
  @Output() appHorizontalScroll = new EventEmitter<number>();

  private readonly syncTargets = new Set<HTMLElement>();
  private listener?: () => void;
  private pendingScrollLeft: number | null = null;
  private frameHandle: number | null = null;

  constructor(private readonly elementRef: ElementRef<HTMLElement>) {}

  @Input('appTrackHorizontalScroll')
  set syncTarget(target: HTMLElement | HTMLElement[] | null | undefined) {
    this.syncTargets.clear();
    if (!target) {
      return;
    }
    if (Array.isArray(target)) {
      target.filter(Boolean).forEach((t) => this.syncTargets.add(t));
    } else {
      this.syncTargets.add(target);
    }
  }

  @Input()
  set appScrollLeft(value: number | null | undefined) {
    if (value === null || value === undefined) {
      return;
    }
    const element = this.elementRef.nativeElement;
    if (Math.abs(element.scrollLeft - value) > 1) {
      ignoreNextScrollEvent(element);
      element.scrollLeft = value;
    }
  }

  ngOnInit(): void {
    const element = this.elementRef.nativeElement;
    const flush = () => {
      this.frameHandle = null;
      const scrollLeft = this.pendingScrollLeft;
      this.pendingScrollLeft = null;
      if (scrollLeft === null) {
        return;
      }
      this.appHorizontalScroll.emit(scrollLeft);
      this.syncTargets.forEach((target) => {
        if (Math.abs(target.scrollLeft - scrollLeft) > 1) {
          ignoreNextScrollEvent(target);
          target.scrollLeft = scrollLeft;
        }
      });
    };

    const scheduleFlush = () => {
      if (this.frameHandle !== null) {
        return;
      }
      if (typeof requestAnimationFrame === 'function') {
        this.frameHandle = requestAnimationFrame(flush);
        return;
      }
      this.frameHandle = window.setTimeout(flush, 16);
    };

    const handler = () => {
      if (consumeIgnoredScrollEvent(element)) {
        return;
      }
      this.pendingScrollLeft = element.scrollLeft;
      scheduleFlush();
    };
    element.addEventListener('scroll', handler, { passive: true });
    this.listener = () => element.removeEventListener('scroll', handler);
  }

  ngOnDestroy(): void {
    this.listener?.();
    if (this.frameHandle !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.frameHandle);
      } else {
        clearTimeout(this.frameHandle);
      }
      this.frameHandle = null;
    }
    this.pendingScrollLeft = null;
  }

  setScrollLeft(value: number) {
    this.appScrollLeft = value;
  }

  get element(): HTMLElement {
    return this.elementRef.nativeElement;
  }
}
