import { Component, inject, input, output, signal } from '@angular/core';
import { Api, TreeData } from '../../core/api';

/**
 * Development only (the server has DEBUG_TOOLS=1): the festive level and the
 * mandarins are changed on the fly, the scene follows at once. Not translated.
 */
@Component({
  selector: 'debug-panel',
  template: `
    <button class="tag debug-toggle" (click)="open.set(!open())" aria-label="Debug">🐞</button>
    @if (open()) {
      <div class="debug-card">
        <label>
          <span
            >Уровень: <b>{{ level() ?? 'авто' }}</b></span
          >
          <input
            type="range"
            min="1"
            max="10"
            [value]="level() ?? tree().level"
            (change)="setLevel(+$any($event.target).value)"
          />
        </label>
        <button class="debug-btn" [disabled]="level() === null" (click)="setLevel(null)">
          Настоящий уровень
        </button>
        <label>
          <span>🍊 Мандаринки</span>
          <input
            #m
            type="number"
            min="0"
            [value]="tree().mandarins"
            (keydown.enter)="setMandarins(+m.value)"
          />
        </label>
        <div class="debug-row">
          <button class="debug-btn" (click)="setMandarins(+m.value)">Задать</button>
          <button class="debug-btn" (click)="setMandarins(tree().mandarins + 500)">+500</button>
          <button class="debug-btn" (click)="setMandarins(0)">0</button>
        </div>
        @if (error()) {
          <small class="debug-error">{{ error() }}</small>
        }
      </div>
    }
  `,
  styles: `
    :host {
      position: absolute;
      z-index: 6;
      left: 0.8rem;
      top: 3.6rem;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.4rem;
      font-size: 0.85rem;
    }
    .debug-toggle {
      width: 2.4rem;
      height: 2.4rem;
      border: 0;
      border-radius: 50%;
      background: var(--paper);
      cursor: pointer;
    }
    .debug-card {
      width: 13rem;
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      padding: 0.6rem;
      border: 1.5px dashed var(--stamp);
      background: var(--paper);
      color: var(--ink);
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    input {
      font: inherit;
      width: 100%;
      box-sizing: border-box;
    }
    .debug-row {
      display: flex;
      gap: 0.3rem;
    }
    .debug-btn {
      flex: 1;
      font: inherit;
      padding: 0.25rem 0.4rem;
      border: 1px solid var(--rule);
      background: var(--paper-2);
      color: var(--ink);
      cursor: pointer;
    }
    .debug-error {
      color: var(--stamp);
    }
  `,
})
export class DebugPanel {
  private readonly api = inject(Api);
  readonly tree = input.required<TreeData>();
  /** The server answered with the new tree */
  readonly changed = output<TreeData>();

  protected readonly open = signal(false);
  /** Forced level (null: the real one) */
  protected readonly level = signal<number | null>(null);
  protected readonly error = signal('');

  protected setLevel(level: number | null): Promise<void> {
    this.level.set(level);
    return this.send({ level });
  }

  protected setMandarins(value: number): Promise<void> {
    return this.send({ mandarins: Math.max(0, Math.round(value) || 0) });
  }

  private async send(body: { level?: number | null; mandarins?: number }): Promise<void> {
    try {
      this.error.set('');
      this.changed.emit(await this.api.debug(body));
    } catch (err) {
      this.error.set(String(err));
    }
  }
}
