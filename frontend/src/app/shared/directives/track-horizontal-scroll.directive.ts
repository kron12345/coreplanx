import { Directive, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';

@Directive({
  selector: '[appTrackHorizontalScroll]',
  standalone: true,
  exportAs: 'appTrackHorizontalScroll',
})
export class TrackHorizontalScrollDirective implements OnInit, OnDestroy {
  @Output() appHorizontalScroll = new EventEmitter<number>();

  private readonly syncTargets = new Set<HTMLElement>();
  private listener?: () => void;

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
      element.scrollLeft = value;
    }
  }

  ngOnInit(): void {
    const element = this.elementRef.nativeElement;
    const handler = () => {
      const scrollLeft = element.scrollLeft;
      this.appHorizontalScroll.emit(scrollLeft);
      this.syncTargets.forEach((target) => {
        if (Math.abs(target.scrollLeft - scrollLeft) > 1) {
          target.scrollLeft = scrollLeft;
        }
      });
    };
    element.addEventListener('scroll', handler, { passive: true });
    this.listener = () => element.removeEventListener('scroll', handler);
  }

  ngOnDestroy(): void {
    this.listener?.();
  }

  setScrollLeft(value: number) {
    this.appScrollLeft = value;
  }

  get element(): HTMLElement {
    return this.elementRef.nativeElement;
  }
}
