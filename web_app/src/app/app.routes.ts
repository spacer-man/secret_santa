import { Routes } from '@angular/router';
import { needsLogin, needsUser } from './core/store';
import { HomePage } from './pages/home';

export const routes: Routes = [
  { path: '', component: HomePage, canActivate: [needsUser] },
  { path: 'login', loadComponent: () => import('./pages/login').then((m) => m.LoginPage), canActivate: [needsLogin] },
  { path: 'register', loadComponent: () => import('./pages/register').then((m) => m.RegisterPage) },
  { path: 'new', loadComponent: () => import('./pages/new-wish').then((m) => m.NewWishPage), canActivate: [needsUser] },
  { path: 'wishes', loadComponent: () => import('./pages/my-wishes').then((m) => m.MyWishesPage), canActivate: [needsUser] },
  { path: 'inbox', loadComponent: () => import('./pages/inbox').then((m) => m.InboxPage), canActivate: [needsUser] },
  { path: '**', redirectTo: '' },
];
