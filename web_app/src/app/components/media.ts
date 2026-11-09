import { Component, input } from '@angular/core';
import { MediaItem } from '../core/api';

@Component({
  selector: 'media-list',
  template: `
    @if (items().length) {
      <div class="media" [class.single]="items().length === 1">
        @for (m of items(); track m.id) {
          @switch (m.type) {
            @case ('image') {
              <img [src]="m.url" alt="" loading="lazy" />
            }
            @case ('audio') {
              <audio [src]="m.url" controls preload="metadata"></audio>
            }
            @case ('voice') {
              <audio [src]="m.url" controls preload="metadata"></audio>
            }
            @case ('video_note') {
              <video class="round" [src]="m.url" controls playsinline preload="metadata"></video>
            }
            @default {
              <video [src]="m.url" controls playsinline preload="metadata"></video>
            }
          }
        }
      </div>
    }
  `,
})
export class MediaList {
  readonly items = input.required<MediaItem[]>();
}
