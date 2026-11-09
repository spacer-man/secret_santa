import { Component, output, signal } from '@angular/core';

/** Big wrapped gift: shakes on tap, then bursts open */
@Component({
  selector: 'gift-box',
  template: `
    <button class="gift" [class.opening]="opening()" (click)="tap()" aria-label="Open the gift">
      <span class="lid"></span>
      <span class="box"></span>
      <span class="ribbon"></span>
      <span class="glow"></span>
    </button>
  `,
})
export class GiftBox {
  readonly opened = output<void>();
  protected readonly opening = signal(false);

  tap(): void {
    if (this.opening()) return;
    this.opening.set(true);
    setTimeout(() => this.opened.emit(), 900);
  }
}
