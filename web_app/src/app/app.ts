import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NewYearTimer } from './components/new-year-timer/new-year-timer';
import { Wish } from './components/wish/wish';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NewYearTimer, Wish],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('secret_santa_web_app_frontend');
}
